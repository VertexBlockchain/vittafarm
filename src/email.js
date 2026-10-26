const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function sendRemainingPixEmail({ apiKey, from, to, productName, productDose, orderId, amountCents, pix, fetchImpl = fetch }) {
  if (typeof apiKey !== 'string' || !apiKey || typeof from !== 'string' || !from.includes('@')) {
    throw new Error('O envio de e-mail não está configurado.');
  }
  if (typeof to !== 'string' || !to.includes('@') || !Number.isSafeInteger(amountCents) || amountCents <= 0 || typeof pix !== 'string' || !pix.trim()) {
    throw new Error('Os dados da cobrança por e-mail são inválidos.');
  }

  const amount = (amountCents / 100).toFixed(2);
  const safeName = escapeHtml(productName);
  const safeDose = escapeHtml(productDose);
  const safeOrder = escapeHtml(orderId);
  const safePix = escapeHtml(pix.trim());
  const text = [
    'Olá! Aqui está a cobrança Pix do saldo restante do seu pedido Vitta Farm.',
    `Produto: ${productName} ${productDose}`,
    `Pedido: ${orderId}`,
    `Saldo a pagar via Pix: R$ ${amount.replace('.', ',')}`,
    'Este saldo corresponde aos 65% restantes do produto. O frete fixo de R$ 30,00 já foi incluído na cobrança da entrada de 35%.',
    'Pix copia e cola:',
    pix.trim(),
    'Se você não reconhece este pedido, entre em contato com o suporte da Vitta Farm.',
  ].join('\n\n');
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f6f6ef;font-family:Arial,sans-serif;color:#173c38"><main style="max-width:560px;margin:auto;padding:28px;background:#fffefa;border:1px solid #d8e0d8;border-radius:16px"><h1 style="font-size:22px">Pix do saldo restante</h1><p>Olá! Aqui está a cobrança Pix do saldo do seu pedido Vitta Farm.</p><p><strong>Produto:</strong> ${safeName} ${safeDose}<br><strong>Pedido:</strong> ${safeOrder}</p><p style="font-size:20px"><strong>Saldo a pagar via Pix: R$ ${amount.replace('.', ',')}</strong></p><p>Este saldo corresponde aos 65% restantes do produto. O frete fixo de R$ 30,00 já foi incluído na cobrança da entrada de 35%.</p><p><strong>Pix copia e cola</strong></p><pre style="padding:14px;white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f5ef;border-radius:8px;font-size:12px">${safePix}</pre><p style="font-size:12px;color:#61746b">Se você não reconhece este pedido, entre em contato com o suporte da Vitta Farm.</p></main></body></html>`;

  let response;
  try {
    response = await fetchImpl(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject: 'Vitta Farm — Pix do saldo restante do pedido', text, html }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error('Não foi possível confirmar o envio do e-mail com o Pix do saldo.');
  }

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  if (!response.ok || typeof result?.id !== 'string' || !result.id) {
    throw new Error('Não foi possível confirmar o envio do e-mail com o Pix do saldo.');
  }
  return { emailId: result.id };
}

module.exports = { sendRemainingPixEmail };
