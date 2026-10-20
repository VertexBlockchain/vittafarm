const PIXGATE_CASHIN_URL = 'https://app.pixgateip.com/api/v1/cashin';
const MAX_TRANSACTION_ID_LENGTH = 128;

function buildPixgatePayload({ nome, cpf, product, device }) {
  if (!product || !Number.isSafeInteger(product.priceCents) || product.priceCents <= 0) {
    throw new Error('O produto não tem preço válido.');
  }
  return {
    nome,
    cpf,
    valor: Number((product.priceCents / 100).toFixed(2)),
    descricao: `Vitta Farm - ${product.name} ${product.dose}`,
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
