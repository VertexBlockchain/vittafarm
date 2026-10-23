const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../catalog.json');
const { isValidCpf, isValidCnpj, validateCheckout } = require('../src/validation');

const products = Object.fromEntries(catalog.products.map((product) => [product.id, product]));
const validCheckout = () => ({
  productId: 'lipoless',
  checkoutRequestId: 'f4b6f8c9-1f3f-4f8a-8d17-2115c2a19b30',
  nome: 'Cliente de Teste',
  cpf: '11144477735',
  email: 'cliente@example.com',
  password: 'senha-segura-com-12',
  passwordConfirmation: 'senha-segura-com-12',
  device: 'web',
  consent: true,
  accountConsent: true,
  deliveryConsent: true,
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
  const result = validateCheckout(validCheckout(), products, 0);
  assert.equal(result.ok, true);
  assert.equal(result.value.totalCents, products.lipoless.priceCents);
  assert.equal(result.value.cpf, '11144477735');
  assert.equal(result.value.email, 'cliente@example.com');
  assert.equal(Object.hasOwn(result.value, 'password'), false, 'a senha não deve seguir para a camada de pedidos');
  assert.equal(result.value.address.cep, '01001000');
  assert.equal(result.value.address.state, 'SP');
  assert.equal(result.value.address.complement, 'Apto 2');
});

test('rejeita endereço incompleto, consentimento ausente e preço enviado pelo navegador', () => {
  const missingAddress = validCheckout();
  missingAddress.address.cep = '123';
  assert.equal(validateCheckout(missingAddress, products, 0).ok, false);

  const missingConsent = validCheckout();
  missingConsent.deliveryConsent = false;
  assert.equal(validateCheckout(missingConsent, products, 0).ok, false);

  const forgedPrice = { ...validCheckout(), priceCents: 1 };
  assert.equal(validateCheckout(forgedPrice, products, 0).ok, false);
});

test('exige aceite de pesquisa para GHK-Cu', () => {
  const order = { ...validCheckout(), productId: 'ghk-cu-thera' };
  assert.equal(validateCheckout(order, products, 0).ok, false);
  order.researchUseConsent = true;
  assert.equal(validateCheckout(order, products, 0).ok, true);
});

test('exige e-mail válido, senha longa e consentimento para a conta', () => {
  const noConsent = { ...validCheckout(), accountConsent: false };
  assert.equal(validateCheckout(noConsent, products, 0).ok, false);

  const shortPassword = { ...validCheckout(), password: 'curta' };
  assert.equal(validateCheckout(shortPassword, products, 0).ok, false);

  const differentPassword = { ...validCheckout(), passwordConfirmation: 'outra-senha-segura' };
  assert.equal(validateCheckout(differentPassword, products, 0).ok, false);

  const invalidEmail = { ...validCheckout(), email: 'sem-email' };
  assert.equal(validateCheckout(invalidEmail, products, 0).ok, false);
});
