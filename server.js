const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname);
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 16 * 1024;
const PIXGATE_CASHIN_URL = 'https://app.pixgateip.com/api/v1/cashin';
const catalog = require('./catalog.json');
const PRODUCTS = Object.freeze(Object.fromEntries(catalog.products.map((product) => [product.id, product])));

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
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
  if (contentType !== 'application/json') {
    throw validationError(415, 'Envie os dados do formulário em JSON.');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw validationError(413, 'O formulário excedeu o tamanho permitido.');
    }
    chunks.push(chunk);
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw validationError(400, 'Não foi possível ler o formulário.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw validationError(400, 'O formulário está incompleto.');
  }
  return parsed;
}

function hasRepeatedDigits(value) {
  return /^([0-9])\1+$/.test(value);
}

function isValidCpf(value) {
  if (!/^\d{11}$/.test(value) || hasRepeatedDigits(value)) return false;
  const digits = value.split('').map(Number);
  for (let position = 9; position <= 10; position += 1) {
    let sum = 0;
    for (let index = 0; index < position; index += 1) {
      sum += digits[index] * (position + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    const checkDigit = remainder === 10 ? 0 : remainder;
    if (digits[position] !== checkDigit) return false;
  }
  return true;
}

function isValidCnpj(value) {
  if (!/^\d{14}$/.test(value) || hasRepeatedDigits(value)) return false;
  const digits = value.split('').map(Number);
  const firstWeights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const secondWeights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const calculateDigit = (length, weights) => {
    const sum = digits.slice(0, length).reduce((total, digit, index) => total + digit * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return digits[12] === calculateDigit(12, firstWeights)
    && digits[13] === calculateDigit(13, secondWeights);
}

function isValidCpfOrCnpj(value) {
  return isValidCpf(value) || isValidCnpj(value);
}

async function handleCashIn(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message });
  }

  const allowedKeys = new Set(['productId', 'nome', 'cpf', 'device', 'consent']);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return sendJson(res, 400, { error: 'O formulário contém campos não permitidos.' });
  }

  const product = typeof body.productId === 'string' ? PRODUCTS[body.productId] : undefined;
  const nome = typeof body.nome === 'string' ? body.nome.trim().replace(/\s+/g, ' ') : '';
  const cpf = typeof body.cpf === 'string' ? body.cpf.replace(/\D/g, '') : '';
  const device = body.device;
  const nameParts = nome.split(' ').filter(Boolean);

  if (body.consent !== true) {
    return sendJson(res, 400, { error: 'Confirme o envio dos dados à Pixgate para gerar o PIX.' });
  }
  if (!product) return sendJson(res, 400, { error: 'Selecione um produto válido.' });
  if (nome.length < 3 || nome.length > 120 || nameParts.length < 2) {
    return sendJson(res, 400, { error: 'Informe seu nome completo.' });
  }
  if (!isValidCpfOrCnpj(cpf)) {
    return sendJson(res, 400, { error: 'Informe um CPF ou CNPJ válido, somente com números.' });
  }
  if (!['android', 'ios', 'web'].includes(device)) {
    return sendJson(res, 400, { error: 'Não foi possível identificar o dispositivo. Atualize a página e tente novamente.' });
  }

  const apiKey = process.env.PIXGATE_API_KEY;
  if (!apiKey) {
    return sendJson(res, 503, { error: 'A cobrança PIX está temporariamente indisponível.' });
  }

  const valor = Number((product.priceCents / 100).toFixed(2));
  const payload = {
    nome,
    cpf,
    valor,
    descricao: `Vitta Farm - ${product.name} ${product.dose}`,
    device,
  };

  let providerResponse;
  let result;
  try {
    providerResponse = await fetch(PIXGATE_CASHIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Apikey: apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    result = await providerResponse.json();
  } catch {
    return sendJson(res, 502, { error: 'Não foi possível confirmar o resultado da solicitação. Confira o status no painel da Pixgate antes de tentar novamente, para evitar uma cobrança duplicada.' });
  }

  if (!providerResponse.ok) {
    return sendJson(res, 502, {
      error: 'A Pixgate não confirmou a cobrança. Confira o status antes de tentar novamente, para evitar duplicidade.',
      transactionId: result?.id == null ? '' : String(result.id),
    });
  }
  if (!result || typeof result.pix !== 'string' || !result.pix.trim()) {
    return sendJson(res, 502, {
      error: 'A Pixgate respondeu sem um código PIX. Confira a cobrança no painel antes de tentar novamente, para evitar duplicidade.',
      transactionId: result?.id == null ? '' : String(result.id),
    });
  }

  const returnedValue = Number(result.value);
  return sendJson(res, 200, {
    transactionId: result.id == null ? '' : String(result.id),
    pix: result.pix,
    value: Number.isFinite(returnedValue) ? returnedValue : valor,
    status: typeof result.status === 'string' ? result.status : 'PENDING',
  });
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
});

const publicRootFiles = new Set(['index.html', 'styles.css', 'app.js', 'catalog.json', 'manus-routes.json']);
const publicImagePath = /^images\/[a-z0-9._-]+\.(?:png|jpe?g|svg)$/i;

async function serveStatic(req, res, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { 'Cache-Control': 'no-store' });
    return res.end('Solicitação inválida.');
  }

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relativePath);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    res.writeHead(403, { 'Cache-Control': 'no-store' });
    return res.end('Acesso negado.');
  }
  if (!publicRootFiles.has(relativePath) && !publicImagePath.test(relativePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('Não encontrado.');
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('Not a file');
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('Não encontrado.');
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    if (requestUrl.pathname === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
      return sendJson(res, 200, { status: 'ok' });
    }
    if (requestUrl.pathname === '/api/cashin') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { error: 'Use POST para criar uma cobrança.' });
      }
      return handleCashIn(req, res);
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res, requestUrl.pathname);
    }
    res.writeHead(405, { Allow: 'GET, HEAD, POST', 'Cache-Control': 'no-store' });
    return res.end('Método não permitido.');
  });
}

if (require.main === module) {
  createServer().listen(PORT, '0.0.0.0');
}

module.exports = { createServer, isValidCpf, isValidCnpj, isValidCpfOrCnpj };
