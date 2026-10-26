const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../catalog.json');
const { isValidCpf, isValidCnpj, normalizeBrazilPhone, validateCheckout } = require('../src/validation');

const products = Object.fromEntries(catalog.products.map((product) => [product.id, product]));
const validCheckout = () => ({
  productId: 'lipoless',
  paymentMethod: 'avista',
  checkoutRequestId: 'f4b6f8c9-1f3f-4f8a-8d17-2115c2a19b30',
  nome: 'Cliente de Teste',
  cpf: '11144477735',
  email: 'cliente@example.com',
  phone: '(47) 92000-6015',
  password: '123456',
  passwordConfirmation: '123456',
  device: 'web',
  termsConsent: true,
  whatsappMarketingConsent: false,
  address: {
    cep: '01001-000',
    street: 'Praça da Sé',
    number: '100',
    complement: 'Apto 2',
    neighborhood: 'Sé',
    city: 'São Paulo',
    state: 'sp',
  },
});

test('valida dígitos de CPF e CNPJ', () => {
  assert.equal(isValidCpf('11144477735'), true);
  assert.equal(isValidCpf('11111111111'), false);
  assert.equal(isValidCnpj('11222333000181'), true);
  assert.equal(isValidCnpj('11111111111111'), false);
});

test('normaliza endereço e calcula valor somente a partir do catálogo', () => {
  const result = validateCheckout(validCheckout(), products, 3000);
  assert.equal(result.ok, true);
  assert.equal(result.value.totalCents, products.lipoless.priceCents + 3000);
  assert.equal(result.value.depositCents, result.value.totalCents);
  assert.equal(result.value.cpf, '11144477735');
  assert.equal(result.value.email, 'cliente@example.com');
  assert.equal(Object.hasOwn(result.value, 'password'), false, 'a senha não deve seguir para a camada de pedidos');
  assert.equal(result.value.address.cep, '01001000');
  assert.equal(result.value.address.state, 'SP');
  assert.equal(result.value.address.complement, 'Apto 2');
});

test('rejeita endereço incompleto, aceite único ausente e preço enviado pelo navegador', () => {
  const missingAddress = validCheckout();
  missingAddress.address.cep = '123';
  assert.equal(validateCheckout(missingAddress, products, 3000).ok, false);

  const missingConsent = validCheckout();
  missingConsent.termsConsent = false;
  assert.equal(validateCheckout(missingConsent, products, 3000).ok, false);

  const forgedPrice = { ...validCheckout(), priceCents: 1 };
  assert.equal(validateCheckout(forgedPrice, products, 3000).ok, false);
});

test('o aceite único inclui a declaração exigida para produto de pesquisa', () => {
  const order = { ...validCheckout(), productId: 'ghk-cu-thera' };
  assert.equal(validateCheckout(order, products, 3000).ok, true);
  order.termsConsent = false;
  assert.equal(validateCheckout(order, products, 3000).ok, false);
});

test('exige e-mail válido, senha de no mínimo seis caracteres e confirmação correspondente', () => {
  const shortPassword = { ...validCheckout(), password: '12345', passwordConfirmation: '12345' };
  assert.equal(validateCheckout(shortPassword, products, 0).ok, false);

  const differentPassword = { ...validCheckout(), passwordConfirmation: '654321' };
  assert.equal(validateCheckout(differentPassword, products, 0).ok, false);

  const invalidEmail = { ...validCheckout(), email: 'sem-email' };
  assert.equal(validateCheckout(invalidEmail, products, 3000).ok, false);
});

test('exige telefone válido para contato do pedido e separa consentimento promocional', () => {
  const withConsent = {
    ...validCheckout(),
    phone: '(47) 92000-6015',
    whatsappMarketingConsent: true,
  };
  const result = validateCheckout(withConsent, products, 3000);
  assert.equal(result.ok, true);
  assert.equal(result.value.phone, '+5547920006015');
  assert.equal(result.value.whatsappMarketingConsent, true);

  const withoutConsent = validateCheckout({ ...validCheckout(), phone: '(47) 92000-6015' }, products, 3000);
  assert.equal(withoutConsent.ok, true);
  assert.equal(withoutConsent.value.phone, '+5547920006015', 'telefone é guardado para contato sobre o pedido');
  assert.equal(withoutConsent.value.whatsappMarketingConsent, false);

  const missingPhone = { ...validCheckout(), phone: '' };
  assert.equal(validateCheckout(missingPhone, products, 3000).ok, false);

  assert.equal(normalizeBrazilPhone('+55 47 92000-6015'), '+5547920006015');
  assert.equal(normalizeBrazilPhone('123'), null);
  assert.equal(validateCheckout({ ...withConsent, phone: '' }, products, 3000).ok, false);
});

test('Pix parcelado cobra 35% do produto mais o frete e envia 65% do produto por e-mail', () => {
  const checkout = { ...validCheckout(), paymentMethod: 'parcelado' };
  const result = validateCheckout(checkout, products, 3000);
  const expectedDeposit = Math.floor((products.lipoless.priceCents * 35 + 50) / 100) + 3000;
  assert.equal(result.ok, true);
  assert.equal(result.value.depositCents, expectedDeposit);
  assert.equal(result.value.balanceCents, result.value.totalCents - expectedDeposit);
  assert.equal(result.value.depositCents + result.value.balanceCents, result.value.totalCents);
  assert.equal(validateCheckout(checkout, products, 0).ok, false, 'frete não pode ser zerado');
});
