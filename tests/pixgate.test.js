const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../catalog.json');
const { buildPixgatePayload } = require('../src/pixgate');

test('payload Pixgate não contém CEP, rua ou qualquer outro endereço', () => {
  const product = catalog.products.find((item) => item.id === 'lipoless');
  const payload = buildPixgatePayload({
    nome: 'Cliente de Teste',
    cpf: '11144477735',
    product,
    device: 'web',
    postbackUrl: 'https://vittafarm.example/api/pixgate/webhook',
  });
  assert.deepEqual(Object.keys(payload).sort(), ['cpf', 'descricao', 'device', 'nome', 'postback', 'valor']);
  assert.equal(payload.valor, (product.priceCents / 100).toFixed(2));
  assert.equal(payload.postback, 'https://vittafarm.example/api/pixgate/webhook');
  assert.equal(JSON.stringify(payload).includes('01001000'), false);
  assert.equal(JSON.stringify(payload).includes('Praça da Sé'), false);
});
