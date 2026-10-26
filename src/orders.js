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

async function refreshOrderPaymentStatus(pool, orderId) {
  const [rows] = await pool.execute('SELECT payment_kind, payment_status FROM order_payments WHERE order_id = ?', [orderId]);
  const [orders] = await pool.execute('SELECT payment_method FROM orders WHERE id = ? LIMIT 1', [orderId]);
  const paymentMethod = String(orders[0]?.payment_method || '').toLowerCase();
  const statuses = rows.map((row) => String(row.payment_status).toUpperCase());
  let status = 'CREATING';
  if (statuses.length && statuses.every((value) => value === 'PAID')) {
    const hasTrackedBalance = rows.some((row) => String(row.payment_kind).toUpperCase() === 'BALANCE');
    status = paymentMethod === 'parcelado' && !hasTrackedBalance ? 'PARTIALLY_PAID' : 'PAID';
  }
  else if (statuses.some((value) => value === 'PAID')) status = 'PARTIALLY_PAID';
  else if (statuses.includes('UNKNOWN')) status = 'UNKNOWN';
  else if (statuses.includes('PENDING')) status = 'PENDING';
  await pool.execute('UPDATE orders SET payment_status = ? WHERE id = ?', [status, orderId]);
  return status;
}

async function setOrderPaymentStatus(pool, paymentId, status, transactionId = null) {
  const [rows] = await pool.execute(
    `UPDATE order_payments
        SET payment_status = CASE WHEN payment_status = 'PAID' THEN 'PAID' ELSE ? END,
            pixgate_transaction_id = COALESCE(pixgate_transaction_id, ?),
            updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      WHERE id = ? AND (pixgate_transaction_id IS NULL OR pixgate_transaction_id = ?)
      RETURNING order_id`,
    [status, transactionId, paymentId, transactionId],
  );
  return rows[0]?.order_id || '';
}

async function processCheckout({
  pool,
  body,
  products,
  customerId,
  shippingCents = 3000,
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
  const paymentKinds = order.paymentMethod === 'parcelado'
    ? [{ kind: 'DEPOSIT', amountCents: order.depositCents }]
    : [{ kind: 'FULL', amountCents: order.totalCents }];
  const payments = paymentKinds.map(({ kind, amountCents }) => {
    const token = crypto.randomBytes(32).toString('base64url');
    return {
      id: crypto.randomUUID(),
      kind,
      amountCents,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      callbackUrl: callbackUrlWithToken(postbackUrl, token),
      transactionId: '',
      pix: '',
    };
  });
  const webhookTokenHash = payments[0].tokenHash;

  try {
    await pool.execute(
      `INSERT INTO orders (
        id, checkout_request_id, customer_id, webhook_token_hash, product_id, product_name, product_dose, product_packaging,
        unit_price_cents, shipping_cents, total_cents, payer_name,
        address_cep, address_street, address_number, address_complement,
        address_neighborhood, address_city, address_state,
        delivery_consent_at, pixgate_consent_at, research_consent_at, payment_status, payment_method
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
        CASE WHEN ? THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') ELSE NULL END, 'CREATING', ?
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
        order.paymentMethod,
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

  try {
    for (const payment of payments) {
      await pool.execute(
        `INSERT INTO order_payments (id, order_id, payment_kind, amount_cents, webhook_token_hash, payment_status)
         VALUES (?, ?, ?, ?, ?, 'CREATING')`,
        [payment.id, orderId, payment.kind, payment.amountCents, payment.tokenHash],
      );
    }
  } catch {
    try { await setOrderStatus(pool, orderId, 'UNKNOWN'); } catch { /* Registro principal fica disponível para conferência. */ }
    return apiError(503, 'Não foi possível preparar as cobranças do pedido. Confira antes de tentar novamente.', false);
  }

  for (const payment of payments) {
    let providerResult;
    try {
      const payload = buildPixgatePayload({
        nome: order.nome,
        cpf: order.cpf,
        product: order.product,
        device: order.device,
        amountCents: payment.amountCents,
        shippingCents: order.shippingCents,
        paymentKind: payment.kind,
        postbackUrl: payment.callbackUrl,
      });
      providerResult = await requestPixgate(payload, apiKey, fetchImpl);
    } catch {
      try {
        await setOrderPaymentStatus(pool, payment.id, 'UNKNOWN');
        await refreshOrderPaymentStatus(pool, orderId);
      } catch { /* A linha de pagamento permanece disponível para conferência. */ }
      return {
        statusCode: 502,
        body: {
          error: 'Não foi possível confirmar uma das cobranças Pix. O pedido foi registrado para conferência; não tente gerar outra cobrança.',
          retrySafe: false,
          orderId,
        },
      };
    }

    const data = providerResult.data;
    const transactionId = normalizeTransactionId(data?.id);
    if (!providerResult.ok || typeof data?.pix !== 'string' || !data.pix.trim() || !transactionId) {
      try {
        await setOrderPaymentStatus(pool, payment.id, 'UNKNOWN', transactionId);
        await refreshOrderPaymentStatus(pool, orderId);
      } catch { /* O estado permanece visível no painel para conferência manual. */ }
      return {
        statusCode: 502,
        body: {
          error: 'A Pixgate não confirmou uma das cobranças. O pedido foi registrado para conferência; não tente novamente.',
          retrySafe: false,
          orderId,
          transactionId: transactionId || '',
        },
      };
    }

    payment.transactionId = transactionId;
    payment.pix = data.pix.trim();
    try {
      const updatedOrderId = await setOrderPaymentStatus(pool, payment.id, 'PENDING', transactionId);
      if (updatedOrderId !== orderId) throw new Error('Pagamento não atualizado.');
      if (payment === payments[0]) {
        await pool.execute('UPDATE orders SET pixgate_transaction_id = COALESCE(pixgate_transaction_id, ?) WHERE id = ?', [transactionId, orderId]);
      }
      await refreshOrderPaymentStatus(pool, orderId);
    } catch {
      return {
        statusCode: 502,
        body: {
          error: 'A Pixgate respondeu, mas não foi possível atualizar o pedido. Não tente gerar outra cobrança; use o identificador do pedido para conferência.',
          retrySafe: false,
          orderId,
          transactionId,
        },
      };
    }
  }

  let qrCodeDataUrl = '';
  const pix = payments[0].pix;
  try {
    qrCodeDataUrl = await QRCode.toDataURL(pix, {
      errorCorrectionLevel: 'L',
      margin: 4,
      width: 640,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch {
    // O copia e cola continua disponível caso a resposta não possa ser codificada como QR.
  }

  return {
    statusCode: 200,
    body: {
      orderId,
      transactionId: payments[0].transactionId,
      pix,
      qrCodeDataUrl,
      value: Number((payments[0].amountCents / 100).toFixed(2)),
      totalValue: Number((order.totalCents / 100).toFixed(2)),
      balanceValue: order.paymentMethod === 'parcelado' ? Number((order.balanceCents / 100).toFixed(2)) : 0,
      paymentMethod: order.paymentMethod,
      status: 'PENDING',
    },
  };
}

function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

async function listCustomersForAdmin(pool) {
  const [rows] = await pool.execute(
    `SELECT customers.id, customers.email, customers.display_name, customers.phone, customers.created_at,
       CASE
         WHEN customers.whatsapp_marketing_consent_at IS NOT NULL
           AND customers.whatsapp_marketing_revoked_at IS NULL
         THEN customers.whatsapp_marketing_consent_at ELSE NULL
       END AS marketing_consent_at,
       COALESCE(order_totals.order_count, 0) AS order_count,
       last_order.product_name AS last_order_product_name,
       last_order.payment_status AS last_order_status,
       last_order.created_at AS last_order_at
     FROM customer_accounts customers
     LEFT JOIN (
       SELECT customer_id, COUNT(*) AS order_count
         FROM orders
        WHERE customer_id IS NOT NULL
        GROUP BY customer_id
     ) order_totals ON order_totals.customer_id = customers.id
     LEFT JOIN LATERAL (
       SELECT product_name, payment_status, created_at
         FROM orders
        WHERE customer_id = customers.id
        ORDER BY created_at DESC
        LIMIT 1
     ) last_order ON TRUE
     ORDER BY CASE WHEN last_order.payment_status = 'PAID' THEN 1 ELSE 0 END,
       COALESCE(last_order.created_at, customers.created_at) DESC
     LIMIT 500`,
  );
  return rows.map((row) => ({
    email: row.email,
    displayName: row.display_name,
    phone: row.phone || '',
    whatsappMarketingConsent: Boolean(row.marketing_consent_at),
    orderCount: Number(row.order_count),
    lastOrderProductName: row.last_order_product_name || '',
    lastOrderStatus: row.last_order_status || 'NO_ORDER',
    lastOrderAt: row.last_order_at ? toIso(row.last_order_at) : '',
    createdAt: toIso(row.created_at),
    consentAt: row.marketing_consent_at ? toIso(row.marketing_consent_at) : '',
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
  const [paymentRows] = await pool.execute(
    `UPDATE order_payments
        SET payment_status = 'PAID', pixgate_transaction_id = COALESCE(pixgate_transaction_id, ?),
            updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      WHERE webhook_token_hash = ?
        AND (pixgate_transaction_id IS NULL OR pixgate_transaction_id = ?)
        AND payment_status <> 'PAID'
      RETURNING order_id`,
    [normalized, tokenHash, normalized],
  );
  if (Array.isArray(paymentRows) && paymentRows.length > 0) {
    await refreshOrderPaymentStatus(pool, paymentRows[0].order_id);
    return { known: true, updated: true };
  }

  const [matchedPayments] = await pool.execute(
    `SELECT order_id FROM order_payments
      WHERE webhook_token_hash = ? AND pixgate_transaction_id = ? AND payment_status = 'PAID'
      LIMIT 1`,
    [tokenHash, normalized],
  );
  if (Array.isArray(matchedPayments) && matchedPayments.length > 0) return { known: true, updated: false };

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
  listCustomersForAdmin,
  markOrderPaidByTransactionId,
  processCheckout,
};
