const crypto = require('node:crypto');
const { validateCheckout } = require('./validation');
const { buildPixgatePayload, normalizeTransactionId, requestPixgate } = require('./pixgate');

function apiError(statusCode, error, retrySafe) {
  return { statusCode, body: { error, retrySafe } };
}

async function loadDuplicate(pool, checkoutRequestId) {
  const [rows] = await pool.execute(
    'SELECT id, payment_status, pixgate_transaction_id FROM orders WHERE checkout_request_id = ? LIMIT 1',
    [checkoutRequestId],
  );
  return rows[0] || null;
}

async function setOrderStatus(pool, orderId, paymentStatus, transactionId = null) {
  await pool.execute(
    'UPDATE orders SET payment_status = ?, pixgate_transaction_id = ? WHERE id = ?',
    [paymentStatus, transactionId, orderId],
  );
}

async function processCheckout({
  pool,
  body,
  products,
  shippingCents = 0,
  apiKey,
  ordersEnabled,
  pixgateEnabled,
  fetchImpl = fetch,
}) {
  if (ordersEnabled !== true || pixgateEnabled !== true) {
    return apiError(503, 'A criação de pedidos e cobranças reais está desabilitada nesta prévia. Nenhum pedido foi registrado.', true);
  }
  if (!apiKey) return apiError(503, 'A cobrança PIX está temporariamente indisponível.', true);

  const validation = validateCheckout(body, products, shippingCents);
  if (!validation.ok) return apiError(400, validation.error, true);
  const order = validation.value;
  const orderId = crypto.randomUUID();

  try {
    await pool.execute(
      `INSERT INTO orders (
        id, checkout_request_id, product_id, product_name, product_dose, product_packaging,
        unit_price_cents, shipping_cents, total_cents, payer_name,
        address_cep, address_street, address_number, address_complement,
        address_neighborhood, address_city, address_state,
        delivery_consent_at, pixgate_consent_at, research_consent_at, payment_status
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), IF(?, UTC_TIMESTAMP(3), NULL), 'CREATING'
      )`,
      [
        orderId,
        order.checkoutRequestId,
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
    if (error?.code === 'ER_DUP_ENTRY') {
      try {
        const existing = await loadDuplicate(pool, order.checkoutRequestId);
        return {
          statusCode: 409,
          body: {
            error: 'Esta solicitação já foi iniciada. Confira o painel antes de iniciar outra cobrança.',
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

  const payload = buildPixgatePayload(order);
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
    await setOrderStatus(pool, orderId, 'PENDING', transactionId);
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

  return {
    statusCode: 200,
    body: {
      orderId,
      transactionId,
      pix: data.pix,
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

module.exports = { listOrders, processCheckout };
