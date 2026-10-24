const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const catalog = require('./catalog.json');
const { getPool, pingDatabase, closePool } = require('./src/database');
const {
  getCustomerOrderStatus,
  listCustomerOrders,
  listCustomersForAdmin,
  markOrderPaidByTransactionId,
  processCheckout,
} = require('./src/orders');
const { validateCheckout } = require('./src/validation');
const {
  CustomerAuthError,
  authenticateCustomer,
  createCustomerSession,
  customerSessionCookie,
  deleteCustomerSession,
  expiredCustomerSessionCookie,
  getCustomerForSession,
  newCustomerSessionToken,
  readCustomerSessionToken,
  revokeWhatsappMarketingConsent,
} = require('./src/customer-auth');
const {
  createSession,
  deleteSession,
  expiredSessionCookie,
  isSessionValid,
  newSessionToken,
  passwordConfigured,
  passwordMatches,
  readSessionToken,
  sessionCookie,
} = require('./src/admin-auth');

const ROOT = path.resolve(__dirname);
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 16 * 1024;
const PRODUCTS = Object.freeze(Object.fromEntries(catalog.products.map((product) => [product.id, product])));
const SHIPPING_CENTS = 0;
const publicRootFiles = new Set(['index.html', 'styles.css', 'app.js', 'admin.js', 'account.html', 'account.js', 'catalog.json', 'manus-routes.json']);
const publicImagePath = /^images\/[a-z0-9._-]+\.(?:png|jpe?g|svg|webp)$/i;
const loginFailures = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 8;

function pixgatePostbackUrl() {
  if (process.env.PIXGATE_POSTBACK_URL) return process.env.PIXGATE_POSTBACK_URL;
  if (!process.env.PUBLIC_URL) return '';
  return `${process.env.PUBLIC_URL.replace(/\/$/, '')}/api/pixgate/webhook`;
}

const contentTypes = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
});

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function validationError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readJson(req) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw validationError(415, 'Envie os dados do formulário em JSON.');

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw validationError(413, 'O formulário excedeu o tamanho permitido.');
    chunks.push(chunk);
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid body');
    return parsed;
  } catch {
    throw validationError(400, 'Não foi possível ler o formulário.');
  }
}

function configuredAdminPassword() {
  return process.env.ORDERS_ADMIN_PASSWORD
    || process.env.ADMIN_PANEL_PASSWORD
    || process.env.ADMIN_PASSWORD
    || '';
}

function isAdminEnabled() {
  return passwordConfigured(configuredAdminPassword())
    && process.env.ORDERS_ADMIN_ENABLED !== 'false';
}

function isOrdersEnabled() {
  return process.env.ORDERS_WRITE_ENABLED === 'true';
}

function clientKey(req) {
  return req.socket?.remoteAddress || 'unknown';
}

function remainingLoginDelay(key) {
  const current = loginFailures.get(key);
  if (!current) return 0;
  if (Date.now() - current.windowStart >= LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return 0;
  }
  return current.failures >= MAX_LOGIN_FAILURES
    ? Math.ceil((LOGIN_WINDOW_MS - (Date.now() - current.windowStart)) / 1000)
    : 0;
}

function recordLoginFailure(key) {
  const now = Date.now();
  let current = loginFailures.get(key);
  if (!current || now - current.windowStart >= LOGIN_WINDOW_MS) current = { windowStart: now, failures: 0 };
  current.failures += 1;
  loginFailures.set(key, current);
}

function clearLoginFailures(key) {
  loginFailures.delete(key);
}

async function handleCashIn(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message, retrySafe: true });
  }

  if (!isOrdersEnabled() || process.env.PIXGATE_LIVE_CASHIN !== 'true') {
    return sendJson(res, 503, {
      error: 'A criação de pedidos e cobranças reais está desabilitada nesta prévia. Nenhum pedido foi registrado.',
      retrySafe: true,
    });
  }
  if (!process.env.PIXGATE_API_KEY) {
    return sendJson(res, 503, { error: 'A cobrança PIX está temporariamente indisponível.', retrySafe: true });
  }
  const postbackUrl = pixgatePostbackUrl();
  if (typeof postbackUrl !== 'string' || !postbackUrl.startsWith('https://')) {
    return sendJson(res, 503, { error: 'A confirmação automática do PIX ainda não está configurada. Defina uma URL pública HTTPS para o webhook.', retrySafe: true });
  }

  const validation = validateCheckout(body, PRODUCTS, SHIPPING_CENTS);
  if (!validation.ok) return sendJson(res, 400, { error: validation.error, retrySafe: true });

  let pool;
  try {
    pool = getPool();
  } catch {
    return sendJson(res, 503, { error: 'O serviço de pedidos está temporariamente indisponível.', retrySafe: true });
  }

  const key = `customer:${clientKey(req)}`;
  const delay = remainingLoginDelay(key);
  if (delay > 0) {
    return sendJson(res, 429, { error: 'Muitas tentativas de acesso. Aguarde antes de tentar novamente.', retrySafe: true }, { 'Retry-After': String(delay) });
  }

  let customer;
  try {
    customer = await authenticateCustomer(pool, {
      email: validation.value.email,
      password: body.password,
      displayName: validation.value.nome,
      phone: validation.value.phone,
      whatsappMarketingConsent: validation.value.whatsappMarketingConsent,
      allowCreate: true,
    });
  } catch (error) {
    if (error instanceof CustomerAuthError && error.code === 'INVALID_CREDENTIALS') {
      recordLoginFailure(key);
      return sendJson(res, 401, { error: 'Não foi possível criar a conta ou entrar. Confira o e-mail e a senha.', retrySafe: true });
    }
    return sendJson(res, 503, { error: 'Não foi possível validar sua conta agora.', retrySafe: true });
  }

  const sessionToken = newCustomerSessionToken();
  try {
    await createCustomerSession(pool, customer.id, sessionToken);
    clearLoginFailures(key);
  } catch {
    return sendJson(res, 503, { error: 'Sua conta foi validada, mas não foi possível iniciar a sessão agora.', retrySafe: true });
  }

  const result = await processCheckout({
    pool,
    body,
    products: PRODUCTS,
    customerId: customer.id,
    shippingCents: SHIPPING_CENTS,
    apiKey: process.env.PIXGATE_API_KEY,
    postbackUrl,
    ordersEnabled: isOrdersEnabled(),
    pixgateEnabled: process.env.PIXGATE_LIVE_CASHIN === 'true',
  }).catch(() => ({
    statusCode: 503,
    body: { error: 'O serviço de pedidos está temporariamente indisponível.', retrySafe: true },
  }));

  return sendJson(res, result.statusCode, result.body, { 'Set-Cookie': customerSessionCookie(sessionToken) });
}

async function handlePixgateWebhook(req, res, requestUrl) {
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message });
  }

  const event = String(body.event || '').toLowerCase();
  const status = String(body.status || '').toUpperCase();
  const transactionId = body.transaction_id || body.id;
  const tokens = requestUrl.searchParams.getAll('token');
  if (event !== 'transaction.paid' || status !== 'PAID' || !transactionId || tokens.length !== 1) {
    return sendJson(res, 400, { error: 'Notificação Pixgate inválida.' });
  }

  try {
    const result = await markOrderPaidByTransactionId(getPool(), transactionId, tokens[0]);
    if (!result.known) return sendJson(res, 403, { error: 'Notificação Pixgate não autenticada.' });
    return sendJson(res, 200, { received: true, updated: result.updated });
  } catch {
    return sendJson(res, 503, { error: 'Não foi possível processar a confirmação agora.' });
  }
}

async function requireAdmin(req, res, pool) {
  const token = readSessionToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Autenticação necessária.' });
    return false;
  }
  try {
    if (await isSessionValid(pool, token)) return true;
  } catch {
    sendJson(res, 503, { error: 'Não foi possível validar a sessão agora.' });
    return false;
  }
  sendJson(res, 401, { error: 'Sessão expirada. Entre novamente.' }, { 'Set-Cookie': expiredSessionCookie() });
  return false;
}

async function handleCustomer(req, res, pathname) {
  if (pathname === '/api/customer/login') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Use POST para entrar.' });
    }

    const key = `customer:${clientKey(req)}`;
    const delay = remainingLoginDelay(key);
    if (delay > 0) return sendJson(res, 429, { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' }, { 'Retry-After': String(delay) });

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: error.message });
    }
    if (Object.keys(body).some((field) => !['email', 'password'].includes(field))) {
      return sendJson(res, 400, { error: 'O formulário contém campos não permitidos.' });
    }

    let pool;
    let customer;
    try {
      pool = getPool();
      customer = await authenticateCustomer(pool, { email: body.email, password: body.password, allowCreate: false });
    } catch (error) {
      if (error instanceof CustomerAuthError && error.code === 'INVALID_CREDENTIALS') {
        recordLoginFailure(key);
        return sendJson(res, 401, { error: 'E-mail ou senha inválidos.' });
      }
      return sendJson(res, 503, { error: 'Não foi possível entrar na sua conta agora.' });
    }

    try {
      const priorToken = readCustomerSessionToken(req);
      if (priorToken) await deleteCustomerSession(pool, priorToken);
      const token = await createCustomerSession(pool, customer.id, newCustomerSessionToken());
      clearLoginFailures(key);
      return sendJson(res, 200, {
        authenticated: true,
        customer: {
          email: customer.email,
          displayName: customer.displayName,
          phone: customer.phone || '',
          whatsappMarketingConsent: customer.whatsappMarketingConsent,
        },
      }, { 'Set-Cookie': customerSessionCookie(token) });
    } catch {
      return sendJson(res, 503, { error: 'Não foi possível iniciar sua sessão agora.' });
    }
  }

  if (pathname === '/api/customer/logout') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Use POST para sair.' });
    }
    try {
      await deleteCustomerSession(getPool(), readCustomerSessionToken(req));
    } catch {
      // O cookie será removido mesmo se a sessão não puder ser consultada.
    }
    return sendJson(res, 200, { authenticated: false }, { 'Set-Cookie': expiredCustomerSessionCookie() });
  }

  if (req.method !== 'GET' && pathname !== '/api/customer/marketing-opt-out') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Use GET para consultar sua conta.' });
  }

  let pool;
  let customer;
  try {
    pool = getPool();
    customer = await getCustomerForSession(pool, readCustomerSessionToken(req));
  } catch {
    return sendJson(res, 503, { error: 'Não foi possível validar sua sessão agora.' });
  }
  if (!customer) {
    return sendJson(res, 401, { authenticated: false }, { 'Set-Cookie': expiredCustomerSessionCookie() });
  }

  if (pathname === '/api/customer/marketing-opt-out') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Use POST para cancelar as mensagens promocionais.' });
    }
    try {
      await revokeWhatsappMarketingConsent(pool, customer.id);
      return sendJson(res, 200, { whatsappMarketingConsent: false });
    } catch {
      return sendJson(res, 503, { error: 'Não foi possível atualizar sua autorização agora.' });
    }
  }

  if (pathname === '/api/customer/session') {
    return sendJson(res, 200, {
      authenticated: true,
      customer: {
        email: customer.email,
        displayName: customer.display_name,
        phone: customer.phone || '',
        whatsappMarketingConsent: Boolean(customer.whatsapp_marketing_consent_at),
      },
    });
  }
  if (pathname === '/api/customer/orders') {
    try {
      return sendJson(res, 200, { orders: await listCustomerOrders(pool, customer.id) });
    } catch {
      return sendJson(res, 503, { error: 'Não foi possível consultar seus pedidos agora.' });
    }
  }

  const orderMatch = pathname.match(/^\/api\/customer\/orders\/([0-9a-f-]{36})$/i);
  if (orderMatch) {
    try {
      const order = await getCustomerOrderStatus(pool, customer.id, orderMatch[1]);
      return order
        ? sendJson(res, 200, { order })
        : sendJson(res, 404, { error: 'Pedido não encontrado.' });
    } catch {
      return sendJson(res, 503, { error: 'Não foi possível consultar o pagamento agora.' });
    }
  }
  return sendJson(res, 404, { error: 'Não encontrado.' });
}

async function handleAdmin(req, res, pathname) {
  if (!isAdminEnabled()) return sendJson(res, 503, { error: 'O painel administrativo está desabilitado no servidor.' });

  if (pathname === '/api/admin/login') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Use POST para entrar.' });
    }

    const key = clientKey(req);
    const delay = remainingLoginDelay(key);
    if (delay > 0) return sendJson(res, 429, { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' }, { 'Retry-After': String(delay) });

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: error.message });
    }
    if (Object.keys(body).some((field) => field !== 'password')
      || typeof body.password !== 'string' || body.password.length > 256) {
      recordLoginFailure(key);
      return sendJson(res, 401, { error: 'Senha inválida.' });
    }

    const expectedPassword = configuredAdminPassword();
    if (!passwordConfigured(expectedPassword)) {
      return sendJson(res, 503, { error: 'O painel ainda não está configurado com uma senha segura.' });
    }
    if (!passwordMatches(expectedPassword, body.password)) {
      recordLoginFailure(key);
      return sendJson(res, 401, { error: 'Senha inválida.' });
    }

    try {
      const pool = getPool();
      const token = newSessionToken();
      await createSession(pool, token);
      clearLoginFailures(key);
      return sendJson(res, 200, { authenticated: true }, { 'Set-Cookie': sessionCookie(token) });
    } catch {
      return sendJson(res, 503, { error: 'Não foi possível iniciar a sessão agora.' });
    }
  }

  if (pathname === '/api/admin/logout') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Use POST para sair.' });
    }
    try {
      const token = readSessionToken(req);
      if (token) await deleteSession(getPool(), token);
    } catch {
      // O cookie será removido mesmo que a sessão já tenha expirado no banco.
    }
    return sendJson(res, 200, { authenticated: false }, { 'Set-Cookie': expiredSessionCookie() });
  }

  if (pathname === '/api/admin/session') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: 'Use GET para consultar a sessão.' });
    }
    const token = readSessionToken(req);
    if (!token) return sendJson(res, 401, { authenticated: false });
    const pool = getPool();
    const authenticated = await isSessionValid(pool, token).catch(() => false);
    return authenticated
      ? sendJson(res, 200, { authenticated: true })
      : sendJson(res, 401, { authenticated: false });
  }

  if (pathname === '/api/admin/customers') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: 'Use GET para consultar clientes.' });
    }
    if (!readSessionToken(req)) return sendJson(res, 401, { error: 'Autenticação necessária.' });
    const pool = getPool();
    if (!await requireAdmin(req, res, pool)) return;
    try {
      return sendJson(res, 200, { customers: await listCustomersForAdmin(pool) });
    } catch {
      return sendJson(res, 503, { error: 'Não foi possível consultar os clientes agora.' });
    }
  }

  return sendJson(res, 404, { error: 'Não encontrado.' });
}

async function serveFile(req, res, relativePath, isAdminPage = false) {
  const filePath = path.resolve(ROOT, relativePath);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    res.writeHead(403, { 'Cache-Control': 'no-store' });
    return res.end('Acesso negado.');
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('Not a file');
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': isAdminPage ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': isAdminPage ? 'no-referrer' : 'strict-origin-when-cross-origin',
    });
    return res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('Não encontrado.');
  }
}

async function serveStatic(req, res, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { 'Cache-Control': 'no-store' });
    return res.end('Solicitação inválida.');
  }

  if (decodedPath === '/admin') {
    if (!isAdminEnabled()) {
      res.writeHead(404, { 'Cache-Control': 'no-store' });
      return res.end('Não encontrado.');
    }
    return serveFile(req, res, 'admin.html', true);
  }
  if (decodedPath === '/conta') return serveFile(req, res, 'account.html', true);

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  if (!publicRootFiles.has(relativePath) && !publicImagePath.test(relativePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('Não encontrado.');
  }
  return serveFile(req, res, relativePath);
}

function createServer() {
  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = requestUrl.pathname;

    if (pathname === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
      if (isOrdersEnabled() || isAdminEnabled()) {
        try {
          await pingDatabase();
        } catch {
          return sendJson(res, 503, { status: 'unavailable' });
        }
      }
      return sendJson(res, 200, { status: 'ok' });
    }

    if (pathname === '/api/cashin') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { error: 'Use POST para criar pedido e cobrança PIX.', retrySafe: true });
      }
      return handleCashIn(req, res);
    }

    if (pathname === '/api/pixgate/webhook') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { error: 'Use POST para confirmar a transação Pixgate.' });
      }
      return handlePixgateWebhook(req, res, requestUrl);
    }

    if (pathname.startsWith('/api/customer/')) {
      try {
        return await handleCustomer(req, res, pathname);
      } catch {
        return sendJson(res, 503, { error: 'O serviço de conta está temporariamente indisponível.' });
      }
    }

    if (pathname.startsWith('/api/admin/')) {
      try {
        return await handleAdmin(req, res, pathname);
      } catch {
        return sendJson(res, 503, { error: 'O serviço administrativo está temporariamente indisponível.' });
      }
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
    res.writeHead(405, { Allow: 'GET, HEAD, POST', 'Cache-Control': 'no-store' });
    return res.end('Método não permitido.');
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, '0.0.0.0', () => process.stdout.write(`Vitta Farm ativo na porta ${PORT}.\n`));
  const shutdown = () => {
    server.close(() => closePool().catch(() => {}).finally(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createServer, readJson };
