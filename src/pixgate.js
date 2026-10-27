const PIXGATE_CASHIN_URL = 'https://app.pixgateip.com/api/v1/cashin';
const MAX_TRANSACTION_ID_LENGTH = 128;

function buildPixgatePayload({ nome, cpf, product, device, postbackUrl, amountCents, shippingCents = 3000, paymentKind = 'FULL' }) {
  if (!product || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error('O produto não tem preço válido.');
  }
  if (!Number.isSafeInteger(shippingCents) || shippingCents !== 3000) {
    throw new Error('O frete fixo do pedido é inválido.');
  }
  if (typeof postbackUrl !== 'string' || !postbackUrl.startsWith('https://')) {
    throw new Error('A URL de confirmação Pixgate precisa ser pública e usar HTTPS.');
  }
  const paymentLabel = paymentKind === 'DEPOSIT' ? 'Entrada 35% do total parcelado (+10%)' : paymentKind === 'BALANCE' ? 'Saldo parcelado' : 'À vista';
  const shippingLabel = paymentKind === 'BALANCE'
    ? 'Frete fixo R$ 30,00 já cobrado na entrada'
    : 'Frete fixo R$ 30,00';
  return {
    nome,
    cpf,
    valor: (amountCents / 100).toFixed(2),
    descricao: `Vitta Farm - ${product.name} ${product.dose} - ${paymentLabel} - ${shippingLabel}`,
    postback: postbackUrl,
    device,
  };
}

function normalizeTransactionId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const transactionId = String(value).trim();
  return transactionId && transactionId.length <= MAX_TRANSACTION_ID_LENGTH ? transactionId : null;
}

async function requestPixgate(payload, apiKey, fetchImpl = fetch) {
  if (typeof apiKey !== 'string' || !apiKey) throw new Error('Chave Pixgate ausente.');
  const response = await fetchImpl(PIXGATE_CASHIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Apikey: apiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { ok: response.ok, statusCode: response.status, data };
}

module.exports = { buildPixgatePayload, normalizeTransactionId, requestPixgate };
