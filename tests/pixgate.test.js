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
  });
  assert.deepEqual(Object.keys(payload).sort(), ['cpf', 'descricao', 'device', 'nome', 'valor']);
  assert.equal(payload.valor, product.priceCents / 100);
  assert.equal(JSON.stringify(payload).includes('01001000'), false);
  assert.equal(JSON.stringify(payload).includes('Praça da Sé'), false);
});
