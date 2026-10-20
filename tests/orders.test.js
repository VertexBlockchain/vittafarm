const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../catalog.json');
const { processCheckout } = require('../src/orders');

const products = Object.fromEntries(catalog.products.map((product) => [product.id, product]));
const checkout = () => ({
  productId: 'lipoless',
  checkoutRequestId: 'f4b6f8c9-1f3f-4f8a-8d17-2115c2a19b30',
  nome: 'Cliente de Teste',
  cpf: '11144477735',
  device: 'web',
  consent: true,
  deliveryConsent: true,
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
        return [{ affectedRows: 1 }, []];
      }
      throw new Error('Consulta inesperada no mock.');
    },
  };
}

const enabledOptions = {
  body: checkout(),
  products,
  shippingCents: 0,
  apiKey: 'mock-api-key',
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
      assert.deepEqual(Object.keys(payload).sort(), ['cpf', 'descricao', 'device', 'nome', 'valor']);
      assert.equal(JSON.stringify(payload).includes('Praça da Sé'), false);
      return { ok: true, json: async () => ({ id: 'pixgate-mock-1', pix: 'pix-copy-paste-mock' }) };
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'PENDING');
  assert.equal(result.body.value, products.lipoless.priceCents / 100);
  assert.deepEqual(events, ['insert', 'pixgate', 'update']);
  assert.ok(options.insertParams.includes('Praça da Sé'));
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
