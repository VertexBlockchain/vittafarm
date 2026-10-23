const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS_KEYS = new Set(['cep', 'street', 'number', 'complement', 'neighborhood', 'city', 'state']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHECKOUT_KEYS = new Set([
  'productId', 'checkoutRequestId', 'nome', 'cpf', 'email', 'password', 'passwordConfirmation', 'device', 'consent',
  'accountConsent', 'deliveryConsent', 'researchUseConsent', 'address',
]);

function hasRepeatedDigits(value) {
  return /^([0-9])\1+$/.test(value);
}

function isValidCpf(value) {
  if (!/^\d{11}$/.test(value) || hasRepeatedDigits(value)) return false;
  const digits = value.split('').map(Number);
  for (let position = 9; position <= 10; position += 1) {
    let sum = 0;
    for (let index = 0; index < position; index += 1) {
      sum += digits[index] * (position + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    const checkDigit = remainder === 10 ? 0 : remainder;
    if (digits[position] !== checkDigit) return false;
  }
  return true;
}

function isValidCnpj(value) {
  if (!/^\d{14}$/.test(value) || hasRepeatedDigits(value)) return false;
  const digits = value.split('').map(Number);
  const firstWeights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const secondWeights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const calculateDigit = (length, weights) => {
    const sum = digits.slice(0, length).reduce((total, digit, index) => total + digit * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return digits[12] === calculateDigit(12, firstWeights)
    && digits[13] === calculateDigit(13, secondWeights);
}

function isValidCpfOrCnpj(value) {
  return isValidCpf(value) || isValidCnpj(value);
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length > maxLength) return null;
  return normalized;
}

function invalid(message) {
  return { ok: false, error: message };
}

function validateCheckout(body, products, shippingCents = 0) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('O formulário está incompleto.');
  if (Object.keys(body).some((key) => !CHECKOUT_KEYS.has(key))) return invalid('O formulário contém campos não permitidos.');
  if (typeof body.checkoutRequestId !== 'string' || !UUID_PATTERN.test(body.checkoutRequestId)) {
    return invalid('Atualize a página e tente novamente.');
  }

  const product = typeof body.productId === 'string' ? products[body.productId] : undefined;
  if (!product) return invalid('Selecione um produto válido.');
  if (!Number.isSafeInteger(product.priceCents) || product.priceCents <= 0) {
    return invalid('O preço deste produto ainda não foi confirmado.');
  }
  if (!Number.isSafeInteger(shippingCents) || shippingCents !== 0) {
    return invalid('O envio grátis está temporariamente indisponível.');
  }

  const name = normalizeText(body.nome, 120);
  const nameParts = name ? name.split(' ').filter(Boolean) : [];
  if (!name || name.length < 3 || nameParts.length < 2) return invalid('Informe seu nome completo.');

  if (typeof body.cpf !== 'string' || !/^[\d.\-/\s]+$/.test(body.cpf)) {
    return invalid('Informe um CPF ou CNPJ válido.');
  }
  const cpf = body.cpf.replace(/\D/g, '');
  if (!isValidCpfOrCnpj(cpf)) return invalid('Informe um CPF ou CNPJ válido, somente com números.');

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return invalid('Informe um e-mail válido para sua conta.');
  if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) {
    return invalid('Crie uma senha com pelo menos 12 caracteres.');
  }
  if (body.passwordConfirmation !== body.password) return invalid('A confirmação da senha não corresponde.');

  if (!['android', 'ios', 'web'].includes(body.device)) return invalid('Não foi possível identificar o dispositivo. Atualize a página.');
  if (body.consent !== true) return invalid('Confirme o envio dos dados necessários à cobrança PIX.');
  if (body.accountConsent !== true) return invalid('Autorize o uso do e-mail para criar sua conta e acompanhar os pedidos.');
  if (body.deliveryConsent !== true) return invalid('Confirme o armazenamento dos dados de entrega para registrar o pedido.');
  if (product.researchUseOnly && body.researchUseConsent !== true) {
    return invalid('Confirme que entendeu que este produto é destinado somente à pesquisa e não ao uso humano.');
  }

  const inputAddress = body.address;
  if (!inputAddress || typeof inputAddress !== 'object' || Array.isArray(inputAddress)
    || Object.keys(inputAddress).some((key) => !ADDRESS_KEYS.has(key))) {
    return invalid('Informe o endereço completo para entrega.');
  }

  const rawCep = typeof inputAddress.cep === 'string' ? inputAddress.cep.trim() : '';
  if (!/^\d{5}-?\d{3}$/.test(rawCep)) return invalid('Informe um CEP válido com 8 números.');
  const cep = rawCep.replace(/\D/g, '');
  const street = normalizeText(inputAddress.street, 180);
  const number = normalizeText(inputAddress.number, 40);
  const complement = normalizeText(inputAddress.complement ?? '', 120);
  const neighborhood = normalizeText(inputAddress.neighborhood, 120);
  const city = normalizeText(inputAddress.city, 120);
  const state = normalizeText(inputAddress.state, 2);
  if (!street || street.length < 2) return invalid('Informe uma rua ou avenida válida.');
  if (!number || number.length < 1) return invalid('Informe o número do endereço.');
  if (complement === null) return invalid('Revise o complemento do endereço.');
  if (!neighborhood || neighborhood.length < 2) return invalid('Informe o bairro.');
  if (!city || city.length < 2) return invalid('Informe a cidade.');
  if (!state || !/^[A-Za-z]{2}$/.test(state)) return invalid('Informe a UF com duas letras.');

  const totalCents = product.priceCents + shippingCents;
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return invalid('O valor do pedido é inválido.');

  return {
    ok: true,
    value: {
      checkoutRequestId: body.checkoutRequestId.toLowerCase(),
      product,
      nome: name,
      cpf,
      email,
      device: body.device,
      address: {
        cep,
        street,
        number,
        complement: complement || null,
        neighborhood,
        city,
        state: state.toUpperCase(),
      },
      shippingCents,
      totalCents,
    },
  };
}

module.exports = { UUID_PATTERN, isValidCpf, isValidCnpj, isValidCpfOrCnpj, validateCheckout };
