const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const catalog = require('../catalog.json');
const { listCustomersForAdmin, markOrderPaidByTransactionId, processCheckout } = require('../src/orders');

const products = Object.fromEntries(catalog.products.map((product) => [product.id, product]));
const checkout = () => ({
  productId: 'lipoless',
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

function mockedPool(events, options = {}) {
  return {
    async execute(sql, params) {
      const statement = sql.trimStart();
      if (statement.startsWith('INSERT INTO orders')) {
        events.push('insert');
        if (options.insertError) throw options.insertError;
        options.insertParams = params;
        return [{ affectedRows: 1 }, []];
      }
      if (statement.startsWith('SELECT id, payment_status')) {
        events.push('duplicate-lookup');
        return [[options.duplicate || { id: 'prior-order-id', payment_status: 'UNKNOWN', pixgate_transaction_id: null }], []];
      }
      if (statement.startsWith('UPDATE orders')) {
        events.push('update');
        options.updateParams = params;
        return [[{ id: 'mock-order-id' }], []];
      }
      throw new Error('Consulta inesperada no mock.');
    },
  };
}

const enabledOptions = {
  body: checkout(),
  products,
  customerId: 'bf9950c4-746c-49a9-9736-c97bfa452dea',
  shippingCents: 0,
  apiKey: 'mock-api-key',
  postbackUrl: 'https://vittafarm.example/api/pixgate/webhook',
  ordersEnabled: true,
  pixgateEnabled: true,
};

test('persiste antes da Pixgate, guarda endereço sem CPF e atualiza a cobrança para pendente', async () => {
  const events = [];
  const options = {};
  const pool = mockedPool(events, options);
  const result = await processCheckout({
    ...enabledOptions,
    pool,
    fetchImpl: async (_url, init) => {
      events.push('pixgate');
      assert.deepEqual(events, ['insert', 'pixgate'], 'registro inicial deve preceder chamada externa');
      const payload = JSON.parse(init.body);
      assert.deepEqual(Object.keys(payload).sort(), ['cpf', 'descricao', 'device', 'nome', 'postback', 'valor']);
      const callback = new URL(payload.postback);
      assert.equal(callback.origin + callback.pathname, 'https://vittafarm.example/api/pixgate/webhook');
      assert.match(callback.searchParams.get('token'), /^[A-Za-z0-9_-]{43}$/);
      assert.equal(JSON.stringify(payload).includes('Praça da Sé'), false);
      return { ok: true, json: async () => ({ id: 'pixgate-mock-1', pix: '  pix-copy-paste-mock \n' }) };
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'PENDING');
  assert.match(result.body.qrCodeDataUrl, /^data:image\/png;base64,/);
  assert.equal(result.body.pix, 'pix-copy-paste-mock');
  const qrPng = Buffer.from(result.body.qrCodeDataUrl.split(',')[1], 'base64');
  assert.equal(qrPng.readUInt32BE(16), 640);
  assert.equal(qrPng.readUInt32BE(20), 640);
  assert.equal(result.body.value, products.lipoless.priceCents / 100);
  assert.deepEqual(events, ['insert', 'pixgate', 'update']);
  assert.ok(options.insertParams.includes('Praça da Sé'));
  assert.ok(options.insertParams.includes('bf9950c4-746c-49a9-9736-c97bfa452dea'));
  assert.equal(options.insertParams.some((value) => value === '123456'), false, 'senha nunca deve ser persistida no pedido');
  assert.equal(options.insertParams.includes('11144477735'), false, 'CPF não deve ser persistido');
  assert.deepEqual(options.updateParams.slice(0, 2), ['PENDING', 'pixgate-mock-1']);
});

test('falha ao persistir o pedido e não chama Pixgate', async () => {
  const events = [];
  const result = await processCheckout({
    ...enabledOptions,
    pool: mockedPool(events, { insertError: new Error('mock database unavailable') }),
    fetchImpl: async () => {
      events.push('pixgate');
      throw new Error('não deveria chamar o provedor');
    },
  });

  assert.equal(result.statusCode, 503);
  assert.equal(result.body.retrySafe, true);
  assert.deepEqual(events, ['insert']);
});

test('resposta Pixgate ambígua marca o pedido para conferência e bloqueia repetição', async () => {
  const events = [];
  const options = {};
  const result = await processCheckout({
    ...enabledOptions,
    pool: mockedPool(events, options),
    fetchImpl: async () => {
      events.push('pixgate');
      throw new Error('mock network timeout');
    },
  });

  assert.equal(result.statusCode, 502);
  assert.equal(result.body.retrySafe, false);
  assert.ok(result.body.orderId);
  assert.deepEqual(events, ['insert', 'pixgate', 'update']);
  assert.equal(options.updateParams[0], 'UNKNOWN');
});

test('chave de solicitação repetida não cria outra cobrança', async () => {
  const events = [];
  const duplicateError = Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
  const result = await processCheckout({
    ...enabledOptions,
    pool: mockedPool(events, {
      insertError: duplicateError,
      duplicate: { id: 'existing-order-id', payment_status: 'PENDING', pixgate_transaction_id: 'existing-transaction' },
    }),
    fetchImpl: async () => {
      events.push('pixgate');
      throw new Error('não deveria criar uma segunda cobrança');
    },
  });

  assert.equal(result.statusCode, 409);
  assert.equal(result.body.retrySafe, false);
  assert.equal(result.body.orderId, 'existing-order-id');
  assert.deepEqual(events, ['insert', 'duplicate-lookup']);
});

test('só confirma pagamento com o token secreto correto e aceita postback repetido', async () => {
  const token = crypto.randomBytes(32).toString('base64url');
  let updateCalls = 0;
  let lookupCalls = 0;
  const pool = {
    async execute(sql, params) {
      if (sql.trimStart().startsWith('UPDATE orders')) {
        updateCalls += 1;
        assert.equal(params[0], 'pixgate-mock-1');
        assert.equal(params[1], crypto.createHash('sha256').update(token).digest('hex'));
        return [updateCalls === 1 ? [{ id: 'mock-order-id' }] : [], []];
      }
      if (sql.trimStart().startsWith('SELECT id FROM orders')) {
        lookupCalls += 1;
        return [[{ id: 'mock-order-id' }], []];
      }
      throw new Error('Consulta inesperada no mock.');
    },
  };

  const confirmed = await markOrderPaidByTransactionId(pool, 'pixgate-mock-1', token);
  assert.deepEqual(confirmed, { known: true, updated: true });
  const replayed = await markOrderPaidByTransactionId(pool, 'pixgate-mock-1', token);
  assert.deepEqual(replayed, { known: true, updated: false });
  assert.equal(updateCalls, 2);
  assert.equal(lookupCalls, 1);
  assert.deepEqual(await markOrderPaidByTransactionId(pool, 'pixgate-mock-1', 'token-forjado'), { known: false, updated: false });
});


test('lista administrativa mostra telefone de pedido e estado separado de autorização promocional', async () => {
  const pool = {
    async execute(sql) {
      assert.match(sql, /FROM customer_accounts customers/);
      assert.match(sql, /customers\.phone/);
      assert.match(sql, /whatsapp_marketing_consent_at IS NOT NULL/);
      assert.match(sql, /LEFT JOIN LATERAL/);
      assert.match(sql, /last_order\.payment_status = 'PAID'/);
      return [[
        {
          email: 'autorizado@example.com',
          display_name: 'Cliente Autorizado',
          phone: '+5547920006015',
          marketing_consent_at: new Date('2026-10-24T12:00:00Z'),
          order_count: 2,
          last_order_product_name: 'Lipoless',
          last_order_status: 'PENDING',
          last_order_at: new Date('2026-10-24T12:00:00Z'),
          created_at: new Date('2026-10-20T12:00:00Z'),
        },
        {
          email: 'sem-consentimento@example.com',
          display_name: 'Cliente sem opt-in',
          phone: '+5547999998888',
          marketing_consent_at: null,
          order_count: 1,
          last_order_product_name: 'Tirzec',
          last_order_status: 'PAID',
          last_order_at: new Date('2026-10-23T12:00:00Z'),
          created_at: new Date('2026-10-21T12:00:00Z'),
        },
        {
          email: 'sem-pedido@example.com',
          display_name: 'Cadastro sem pedido',
          phone: '+5547999997777',
          marketing_consent_at: null,
          order_count: 0,
          last_order_product_name: null,
          last_order_status: null,
          last_order_at: null,
          created_at: new Date('2026-10-22T12:00:00Z'),
        },
      ], []];
    },
  };
  const customers = await listCustomersForAdmin(pool);
  assert.equal(customers.length, 3);
  assert.equal(customers[0].email, 'autorizado@example.com');
  assert.equal(customers[0].phone, '+5547920006015');
  assert.equal(customers[0].whatsappMarketingConsent, true);
  assert.equal(customers[0].lastOrderProductName, 'Lipoless');
  assert.equal(customers[0].lastOrderStatus, 'PENDING');
  assert.equal(customers[1].email, 'sem-consentimento@example.com');
  assert.equal(customers[1].phone, '+5547999998888');
  assert.equal(customers[1].whatsappMarketingConsent, false);
  assert.equal(customers[1].lastOrderStatus, 'PAID');
  assert.equal(customers[2].lastOrderStatus, 'NO_ORDER');
  assert.equal(customers[2].orderCount, 0);
});
