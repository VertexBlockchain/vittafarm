const crypto = require('node:crypto');
const QRCode = require('qrcode');
const { validateCheckout, UUID_PATTERN } = require('./validation');
const { buildPixgatePayload, normalizeTransactionId, requestPixgate } = require('./pixgate');

function apiError(statusCode, error, retrySafe) {
  return { statusCode, body: { error, retrySafe } };
}

function callbackUrlWithToken(postbackUrl, token) {
  const url = new URL(postbackUrl);
  if (url.protocol !== 'https:') throw new Error('A URL de confirmação Pixgate precisa ser HTTPS.');
  url.searchParams.set('token', token);
  return url.toString();
}

async function loadDuplicate(pool, checkoutRequestId, customerId) {
  const [rows] = await pool.execute(
    'SELECT id, payment_status, pixgate_transaction_id FROM orders WHERE checkout_request_id = ? AND customer_id = ? LIMIT 1',
    [checkoutRequestId, customerId],
  );
  return rows[0] || null;
}

async function setOrderStatus(pool, orderId, paymentStatus, transactionId = null) {
  const [rows] = await pool.execute(
    `UPDATE orders
        SET payment_status = CASE WHEN payment_status = 'PAID' THEN 'PAID' ELSE ? END,
            pixgate_transaction_id = COALESCE(pixgate_transaction_id, ?)
      WHERE id = ? AND (pixgate_transaction_id IS NULL OR pixgate_transaction_id = ?)
      RETURNING id`,
    [paymentStatus, transactionId, orderId, transactionId],
  );
  return Array.isArray(rows) && rows.length === 1;
}

async function processCheckout({
  pool,
  body,
  products,
  customerId,
  shippingCents = 0,
  apiKey,
  postbackUrl,
  ordersEnabled,
  pixgateEnabled,
  fetchImpl = fetch,
}) {
  if (ordersEnabled !== true || pixgateEnabled !== true) {
    return apiError(503, 'A criação de pedidos e cobranças reais está desabilitada nesta prévia. Nenhum pedido foi registrado.', true);
  }
  if (!apiKey) return apiError(503, 'A cobrança PIX está temporariamente indisponível.', true);
  if (typeof postbackUrl !== 'string' || !postbackUrl.startsWith('https://')) {
    return apiError(503, 'A confirmação automática do PIX ainda não está configurada. Defina uma URL pública HTTPS para o webhook.', true);
  }
  if (typeof customerId !== 'string' || !UUID_PATTERN.test(customerId)) {
    return apiError(401, 'Entre na sua conta para continuar.', true);
  }

  const validation = validateCheckout(body, products, shippingCents);
  if (!validation.ok) return apiError(400, validation.error, true);
  const order = validation.value;
  const orderId = crypto.randomUUID();
  const webhookToken = crypto.randomBytes(32).toString('base64url');
  const webhookTokenHash = crypto.createHash('sha256').update(webhookToken).digest('hex');
  let callbackUrl;
  try {
    callbackUrl = callbackUrlWithToken(postbackUrl, webhookToken);
  } catch {
    return apiError(503, 'A URL de confirmação PIX precisa ser pública e usar HTTPS.', true);
  }

  try {
    await pool.execute(
      `INSERT INTO orders (
        id, checkout_request_id, customer_id, webhook_token_hash, product_id, product_name, product_dose, product_packaging,
        unit_price_cents, shipping_cents, total_cents, payer_name,
        address_cep, address_street, address_number, address_complement,
        address_neighborhood, address_city, address_state,
        delivery_consent_at, pixgate_consent_at, research_consent_at, payment_status
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
        CASE WHEN ? THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') ELSE NULL END, 'CREATING'
      )`,
      [
        orderId,
        order.checkoutRequestId,
        customerId,
        webhookTokenHash,
        order.product.id,
        order.product.name,
        order.product.dose,
        order.product.packageCount || 'Conteúdo não informado',
        order.product.priceCents,
        order.shippingCents,
        order.totalCents,
        order.nome,
        order.address.cep,
        order.address.street,
        order.address.number,
        order.address.complement,
        order.address.neighborhood,
        order.address.city,
        order.address.state,
        order.product.researchUseOnly === true,
      ],
    );
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY' || error?.code === '23505') {
      try {
        const existing = await loadDuplicate(pool, order.checkoutRequestId, customerId);
        return {
          statusCode: 409,
          body: {
            error: 'Esta solicitação já foi iniciada. Confira seus pedidos antes de iniciar outra cobrança.',
            retrySafe: false,
            orderId: existing?.id || '',
            status: existing?.payment_status || 'UNKNOWN',
            transactionId: existing?.pixgate_transaction_id || '',
          },
        };
      } catch {
        return apiError(503, 'A solicitação já pode existir. Confira antes de tentar novamente.', false);
      }
    }
    return apiError(503, 'Não foi possível registrar o pedido; nenhuma cobrança foi enviada à Pixgate.', true);
  }

  const payload = buildPixgatePayload({ ...order, postbackUrl: callbackUrl });
  let providerResult;
  try {
    providerResult = await requestPixgate(payload, apiKey, fetchImpl);
  } catch {
    try {
      await setOrderStatus(pool, orderId, 'UNKNOWN');
    } catch {
      // O registro inicial continua disponível para conferência manual.
    }
    return {
      statusCode: 502,
      body: {
        error: 'Não foi possível confirmar o resultado da Pixgate. O pedido foi registrado para conferência; não tente gerar outra cobrança.',
        retrySafe: false,
        orderId,
      },
    };
  }

  const data = providerResult.data;
  const transactionId = normalizeTransactionId(data?.id);
  if (!providerResult.ok || typeof data?.pix !== 'string' || !data.pix.trim() || !transactionId) {
    try {
      await setOrderStatus(pool, orderId, 'UNKNOWN', transactionId);
    } catch {
      // O estado inicial permanece visível no painel caso a atualização falhe.
    }
    return {
      statusCode: 502,
      body: {
        error: 'A resposta da Pixgate não confirmou uma cobrança utilizável. O pedido foi registrado para conferência; não tente novamente.',
        retrySafe: false,
        orderId,
        transactionId: transactionId || '',
      },
    };
  }

  try {
    const updated = await setOrderStatus(pool, orderId, 'PENDING', transactionId);
    if (!updated) throw new Error('Pedido não atualizado.');
  } catch {
    return {
      statusCode: 502,
      body: {
        error: 'A Pixgate respondeu, mas não foi possível atualizar o pedido. Não tente gerar outra cobrança; use os identificadores para conferência.',
        retrySafe: false,
        orderId,
        transactionId,
      },
    };
  }

  let qrCodeDataUrl = '';
  try {
    qrCodeDataUrl = await QRCode.toDataURL(data.pix, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280,
      color: { dark: '#102b24', light: '#ffffff' },
    });
  } catch {
    // O copia e cola continua disponível caso a resposta não possa ser codificada como QR.
  }

  return {
    statusCode: 200,
    body: {
      orderId,
      transactionId,
      pix: data.pix,
      qrCodeDataUrl,
      value: Number((order.totalCents / 100).toFixed(2)),
      status: 'PENDING',
    },
  };
}

function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

async function listOrders(pool) {
  const [rows] = await pool.execute(
    `SELECT id, product_id, product_name, product_dose, product_packaging,
      unit_price_cents, shipping_cents, total_cents, payer_name,
      address_cep, address_street, address_number, address_complement,
      address_neighborhood, address_city, address_state,
      payment_status, pixgate_transaction_id, created_at
     FROM orders ORDER BY created_at DESC LIMIT 200`,
  );
  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    productDose: row.product_dose,
    productPackaging: row.product_packaging,
    unitPriceCents: Number(row.unit_price_cents),
    shippingCents: Number(row.shipping_cents),
    totalCents: Number(row.total_cents),
    payerName: row.payer_name,
    address: {
      cep: row.address_cep,
      street: row.address_street,
      number: row.address_number,
      complement: row.address_complement || '',
      neighborhood: row.address_neighborhood,
      city: row.address_city,
      state: row.address_state,
    },
    paymentStatus: row.payment_status,
    transactionId: row.pixgate_transaction_id || '',
    createdAt: toIso(row.created_at),
  }));
}

async function listCustomerOrders(pool, customerId) {
  const [rows] = await pool.execute(
    `SELECT id, product_name, total_cents, payment_status, created_at
       FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200`,
    [customerId],
  );
  return rows.map((row) => ({
    id: row.id,
    productName: row.product_name,
    totalCents: Number(row.total_cents),
    paymentStatus: row.payment_status,
    createdAt: toIso(row.created_at),
  }));
}

async function getCustomerOrderStatus(pool, customerId, orderId) {
  if (typeof orderId !== 'string' || !UUID_PATTERN.test(orderId)) return null;
  const [rows] = await pool.execute(
    'SELECT id, payment_status FROM orders WHERE id = ? AND customer_id = ? LIMIT 1',
    [orderId, customerId],
  );
  return rows[0] ? { id: rows[0].id, paymentStatus: rows[0].payment_status } : null;
}

async function markOrderPaidByTransactionId(pool, transactionId, webhookToken) {
  const normalized = normalizeTransactionId(transactionId);
  if (!normalized || typeof webhookToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(webhookToken)) {
    return { known: false, updated: false };
  }
  const tokenHash = crypto.createHash('sha256').update(webhookToken).digest('hex');
  const [updatedRows] = await pool.execute(
    `UPDATE orders
        SET payment_status = 'PAID', pixgate_transaction_id = COALESCE(pixgate_transaction_id, ?)
      WHERE webhook_token_hash = ?
        AND (pixgate_transaction_id IS NULL OR pixgate_transaction_id = ?)
        AND payment_status <> 'PAID'
      RETURNING id`,
    [normalized, tokenHash, normalized],
  );
  if (Array.isArray(updatedRows) && updatedRows.length > 0) return { known: true, updated: true };

  const [matchedRows] = await pool.execute(
    `SELECT id FROM orders
      WHERE webhook_token_hash = ?
        AND (pixgate_transaction_id IS NULL OR pixgate_transaction_id = ?)
      LIMIT 1`,
    [tokenHash, normalized],
  );
  return { known: Array.isArray(matchedRows) && matchedRows.length > 0, updated: false };
}

module.exports = {
  getCustomerOrderStatus,
  listCustomerOrders,
  listOrders,
  markOrderPaidByTransactionId,
  processCheckout,
};
