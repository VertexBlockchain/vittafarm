const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const catalog = require('../catalog.json');
const { listCustomersForAdmin, markOrderPaidByTransactionId, processCheckout } = require('../src/orders');

const products = Object.fromEntries(catalog.products.map((product) => [product.id, product]));
const checkout = (paymentMethod = 'avista') => ({
  productId: 'lipoless',
  paymentMethod,
  checkoutRequestId: 'f4b6f8c9-1f3f-4f8a-8d17-2115c2a19b30',
  nome: 'Cliente de Teste',
  cpf: '11144477735',
  email: 'cliente@example.com',
  phone: '(47) 92000-6015',
  password: '123456',
  passwordConfirmation: '123456',
  device: 'web',
  termsConsent: true,
  address: {
    cep: '01001-000',
    street: 'Praça da Sé',
    number: '100',
    complement: 'Apto 2',
    neighborhood: 'Sé',
    city: 'São Paulo',
    state: 'SP',
  },
});

function mockedPool(events = [], options = {}) {
  const state = { payments: [], orderId: '', orderStatus: '', orderTransactionId: '', paymentMethod: '' };
  const pool = {
    state,
    async execute(sql, params = []) {
      const statement = sql.trimStart();
      if (statement.startsWith('INSERT INTO orders')) {
        events.push('insert-order');
        if (options.insertError) throw options.insertError;
        options.insertParams = params;
        state.orderId = params[0];
        state.paymentMethod = params.at(-1);
        return [{ affectedRows: 1 }, []];
      }
      if (statement.startsWith('INSERT INTO order_payments')) {
        events.push('insert-payment');
        if (options.paymentInsertError) throw options.paymentInsertError;
        state.payments.push({
          id: params[0], order_id: params[1], payment_kind: params[2], amount_cents: params[3],
          webhook_token_hash: params[4], payment_status: 'CREATING', pixgate_transaction_id: null,
        });
        return [{ affectedRows: 1 }, []];
      }
      if (statement.startsWith('SELECT id, payment_status, pixgate_transaction_id FROM orders')) {
        events.push('duplicate-lookup');
        return [[options.duplicate || null].filter(Boolean), []];
      }
      if (statement.startsWith('UPDATE order_payments') && statement.includes('WHERE id = ?')) {
        events.push('payment-update');
        const payment = state.payments.find((row) => row.id === params[2]);
        if (!payment) return [[], []];
        payment.payment_status = params[0];
        if (params[1]) payment.pixgate_transaction_id = params[1];
        return [[{ order_id: payment.order_id }], []];
      }
      if (statement.startsWith('UPDATE order_payments') && statement.includes('WHERE webhook_token_hash = ?')) {
        events.push('webhook-payment-update');
        const payment = state.payments.find((row) => row.webhook_token_hash === params[1]
          && (!row.pixgate_transaction_id || row.pixgate_transaction_id === params[2])
          && row.payment_status !== 'PAID');
        if (!payment) return [[], []];
        payment.payment_status = 'PAID';
        payment.pixgate_transaction_id ||= params[0];
        return [[{ order_id: payment.order_id }], []];
      }
      if (statement.startsWith('SELECT payment_kind, payment_status FROM order_payments')) {
        return [state.payments.filter((row) => row.order_id === params[0]).map((row) => ({ payment_kind: row.payment_kind, payment_status: row.payment_status })), []];
      }
      if (statement.startsWith('SELECT payment_method FROM orders')) {
        return [[{ payment_method: state.paymentMethod }], []];
      }
      if (statement.startsWith('SELECT order_id FROM order_payments')) {
        const payment = state.payments.find((row) => row.webhook_token_hash === params[0]
          && row.pixgate_transaction_id === params[1] && row.payment_status === 'PAID');
        return [[payment ? { order_id: payment.order_id } : null].filter(Boolean), []];
      }
      if (statement.startsWith('UPDATE orders')) {
        events.push('update-order');
        if (statement.includes('pixgate_transaction_id = COALESCE')) {
          state.orderTransactionId ||= params[0];
          return [[{ id: params[1] }], []];
        }
        if (statement.includes('SET payment_status = ?')) {
          state.orderStatus = params[0];
          return [[{ id: params[1] }], []];
        }
        if (statement.includes('SET payment_status = CASE')) {
          state.orderStatus = params[0];
          state.orderTransactionId ||= params[1] || '';
          return [[{ id: params[3] }], []];
        }
        return [[], []];
      }
      if (statement.startsWith('SELECT id FROM orders')) return [[{ id: 'legacy-order-id' }], []];
      throw new Error(`Consulta inesperada no mock: ${statement.slice(0, 100)}`);
    },
  };
  return pool;
}

const enabledOptions = {
  body: checkout(),
  products,
  customerId: 'bf9950c4-746c-49a9-9736-c97bfa452dea',
  shippingCents: 3000,
  apiKey: 'mock-api-key',
  postbackUrl: 'https://vittafarm.example/api/pixgate/webhook',
  ordersEnabled: true,
  pixgateEnabled: true,
};

function pixResponse(index) {
  return { ok: true, json: async () => ({ id: `pixgate-mock-${index}`, pix: `pix-copy-paste-${index}` }) };
}

test('Pix à vista inclui frete, persiste pedido e pagamento antes da Pixgate', async () => {
  const events = [];
  const pool = mockedPool(events);
  const result = await processCheckout({
    ...enabledOptions,
    pool,
    fetchImpl: async (url, init) => {
      events.push('pixgate');
      assert.ok(events.indexOf('insert-order') < events.indexOf('pixgate'));
      assert.ok(events.indexOf('insert-payment') < events.indexOf('pixgate'));
      assert.match(url, /pixgateip\.com/);
      const payload = JSON.parse(init.body);
      assert.deepEqual(Object.keys(payload).sort(), ['cpf', 'descricao', 'device', 'nome', 'postback', 'valor']);
      assert.equal(payload.valor, ((products.lipoless.priceCents + 3000) / 100).toFixed(2));
      assert.match(payload.descricao, /Frete fixo R\$ 30,00/);
      const callback = new URL(payload.postback);
      assert.equal(callback.origin + callback.pathname, 'https://vittafarm.example/api/pixgate/webhook');
      assert.match(callback.searchParams.get('token'), /^[A-Za-z0-9_-]{43}$/);
      assert.equal(JSON.stringify(payload).includes('Praça da Sé'), false);
      return pixResponse(1);
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'PENDING');
  assert.equal(result.body.paymentMethod, 'avista');
  assert.equal(result.body.value, (products.lipoless.priceCents + 3000) / 100);
  assert.equal(result.body.totalValue, result.body.value);
  assert.match(result.body.qrCodeDataUrl, /^data:image\/png;base64,/);
  assert.equal(result.body.pix, 'pix-copy-paste-1');
  assert.equal(pool.state.payments.length, 1);
  assert.equal(pool.state.payments[0].amount_cents, products.lipoless.priceCents + 3000);
  assert.ok(events.indexOf('insert-order') < events.indexOf('pixgate'));
  assert.ok(events.indexOf('insert-payment') < events.indexOf('pixgate'));
});

test('Pix parcelado funciona sem configuração de e-mail e gera só 35% do produto mais frete', async () => {
  const events = [];
  const pool = mockedPool(events);
  const depositCents = Math.floor((products.lipoless.priceCents * 35 + 50) / 100) + 3000;
  const totalCents = products.lipoless.priceCents + 3000;
  const balanceCents = totalCents - depositCents;
  let pixCount = 0;
  const result = await processCheckout({
    ...enabledOptions,
    body: checkout('parcelado'),
    pool,
    fetchImpl: async (url, init) => {
      events.push('pixgate');
      pixCount += 1;
      const payload = JSON.parse(init.body);
      assert.equal(payload.valor, (depositCents / 100).toFixed(2));
      assert.match(payload.descricao, /Entrada 35% \+ frete fixo - Frete fixo R\$ 30,00/);
      return pixResponse(pixCount);
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.paymentMethod, 'parcelado');
  assert.equal(result.body.value, depositCents / 100);
  assert.equal(result.body.balanceValue, balanceCents / 100);
  assert.equal(result.body.totalValue, totalCents / 100);
  assert.equal(result.body.pix, 'pix-copy-paste-1');
  assert.equal(pixCount, 1, 'gera somente o Pix da entrada');
  assert.deepEqual(pool.state.payments.map((row) => row.payment_kind), ['DEPOSIT']);
  assert.deepEqual(pool.state.payments.map((row) => row.amount_cents), [depositCents]);
  assert.deepEqual(events, ['insert-order', 'insert-payment', 'pixgate', 'payment-update', 'update-order', 'update-order']);
});

test('webhook confirma a entrada e mantém o pedido parcialmente pago enquanto resta o saldo parcelado', async () => {
  const events = [];
  const pool = mockedPool(events);
  const callbackTokens = [];
  const created = await processCheckout({
    ...enabledOptions,
    body: checkout('parcelado'),
    pool,
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(init.body);
      callbackTokens.push(new URL(payload.postback).searchParams.get('token'));
      return pixResponse(1);
    },
  });
  assert.equal(created.statusCode, 200);
  const first = await markOrderPaidByTransactionId(pool, 'pixgate-mock-1', callbackTokens[0]);
  assert.deepEqual(first, { known: true, updated: true });
  assert.equal(pool.state.orderStatus, 'PARTIALLY_PAID');
  const replay = await markOrderPaidByTransactionId(pool, 'pixgate-mock-1', callbackTokens[0]);
  assert.deepEqual(replay, { known: true, updated: false });
  assert.equal(pool.state.orderStatus, 'PARTIALLY_PAID');
  assert.deepEqual(await markOrderPaidByTransactionId(pool, 'pixgate-mock-2', 'token-forjado'), { known: false, updated: false });
});

test('falha ao persistir o pedido impede qualquer cobrança', async () => {
  const events = [];
  const result = await processCheckout({
    ...enabledOptions,
    pool: mockedPool(events, { insertError: new Error('database unavailable') }),
    fetchImpl: async () => { events.push('pixgate'); throw new Error('não deveria chamar'); },
  });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.retrySafe, true);
  assert.deepEqual(events, ['insert-order']);
});

test('chave de solicitação repetida não cria outra cobrança', async () => {
  const events = [];
  const duplicateError = Object.assign(new Error('duplicate'), { code: '23505' });
  const result = await processCheckout({
    ...enabledOptions,
    pool: mockedPool(events, {
      insertError: duplicateError,
      duplicate: { id: 'existing-order-id', payment_status: 'PENDING', pixgate_transaction_id: 'existing-transaction' },
    }),
    fetchImpl: async () => { events.push('pixgate'); throw new Error('não deveria chamar'); },
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.retrySafe, false);
  assert.equal(result.body.orderId, 'existing-order-id');
  assert.deepEqual(events, ['insert-order', 'duplicate-lookup']);
});

test('lista administrativa preserva dados de telefone, consentimento e status do pedido', async () => {
  const pool = {
    async execute(sql) {
      assert.match(sql, /FROM customer_accounts customers/);
      assert.match(sql, /customers\.phone/);
      assert.match(sql, /whatsapp_marketing_consent_at IS NOT NULL/);
      assert.match(sql, /LEFT JOIN LATERAL/);
      assert.match(sql, /last_order\.payment_status = 'PAID'/);
      return [[
        {
          email: 'autorizado@example.com', display_name: 'Cliente Autorizado', phone: '+5547920006015',
          marketing_consent_at: new Date('2026-10-24T12:00:00Z'), order_count: 2,
          last_order_product_name: 'Lipoless', last_order_status: 'PARTIALLY_PAID',
          last_order_at: new Date('2026-10-24T12:00:00Z'), created_at: new Date('2026-10-20T12:00:00Z'),
        },
        {
          email: 'sem-consentimento@example.com', display_name: 'Cliente sem opt-in', phone: '+5547999998888',
          marketing_consent_at: null, order_count: 1, last_order_product_name: 'Tirzec',
          last_order_status: 'PAID', last_order_at: new Date('2026-10-23T12:00:00Z'),
          created_at: new Date('2026-10-21T12:00:00Z'),
        },
      ], []];
    },
  };
  const customers = await listCustomersForAdmin(pool);
  assert.equal(customers.length, 2);
  assert.equal(customers[0].lastOrderStatus, 'PARTIALLY_PAID');
  assert.equal(customers[0].whatsappMarketingConsent, true);
  assert.equal(customers[1].lastOrderStatus, 'PAID');
  assert.equal(customers[1].whatsappMarketingConsent, false);
});
