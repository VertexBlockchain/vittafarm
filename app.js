const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const SHIPPING_CENTS = 3000;
const track = document.querySelector('#products-track');
const previousButton = document.querySelector('#carousel-prev');
const nextButton = document.querySelector('#carousel-next');
const carouselStatus = document.querySelector('#carousel-status');
const meter = document.querySelector('#scroll-meter-fill');
const infoDialog = document.querySelector('#product-info-dialog');
const checkoutDialog = document.querySelector('#checkout-dialog');
const whatsappFloat = document.querySelector('#whatsapp-float');
const whatsappFloatClose = document.querySelector('#whatsapp-float-close');
const infoTitle = document.querySelector('#product-info-title');
const infoPackage = document.querySelector('#product-info-package');
const infoBody = document.querySelector('#product-info-body');
const infoSources = document.querySelector('#product-info-sources');
const checkoutForm = document.querySelector('#checkout-form');
const checkoutFormView = document.querySelector('#checkout-form-view');
const checkoutProductName = document.querySelector('#checkout-product-name');
const checkoutProductSummary = document.querySelector('#checkout-product-summary');
const paymentSummary = document.querySelector('#payment-summary');
const checkoutPackageWarning = document.querySelector('#checkout-package-warning');
const checkoutError = document.querySelector('#checkout-error');
const checkoutSubmit = document.querySelector('#checkout-submit');
const checkoutResult = document.querySelector('#pix-result');
const pixStatusMessage = document.querySelector('#pix-status-message');
const paymentFollowupNote = document.querySelector('#payment-followup-note');
const orderIdElement = document.querySelector('#order-id');
const transactionId = document.querySelector('#transaction-id');
const pixCode = document.querySelector('#pix-code');
const copyPixButton = document.querySelector('#copy-pix');
const pixQrFigure = document.querySelector('#pix-qr-figure');
const pixQrImage = document.querySelector('#pix-qr-image');
const checkPaymentButton = document.querySelector('#check-payment');
const paymentCheckMessage = document.querySelector('#payment-check-message');
const nameInput = document.querySelector('#customer-name');
const cpfInput = document.querySelector('#customer-cpf');
const emailInput = document.querySelector('#customer-email');
const phoneInput = document.querySelector('#customer-phone');
const whatsappMarketingConsentInput = document.querySelector('#whatsapp-marketing-consent');
const passwordInput = document.querySelector('#customer-password');
const passwordConfirmationInput = document.querySelector('#customer-password-confirmation');
const cepInput = document.querySelector('#customer-cep');
const lookupCepButton = document.querySelector('#lookup-cep');
const cepStatus = document.querySelector('#cep-status');
const addressInputs = {
  street: document.querySelector('#customer-street'),
  number: document.querySelector('#customer-number'),
  complement: document.querySelector('#customer-complement'),
  neighborhood: document.querySelector('#customer-neighborhood'),
  city: document.querySelector('#customer-city'),
  state: document.querySelector('#customer-state'),
};
const termsConsentInput = document.querySelector('#terms-consent');
const researchUseDeclaration = document.querySelector('#research-use-declaration');
const checkoutTermsDetails = document.querySelector('#checkout-terms-details');
const arrowIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M10 5l5 5-5 5" /></svg>';
const AMBIGUOUS_CHECKOUT_PREFIX = 'vitta:ambiguous-checkout:';
const CHECKOUT_REQUEST_PREFIX = 'vitta:checkout-request:';

let catalog = null;
let selectedProduct = null;
let checkoutRequestId = '';
let currentOrderId = '';
let cepLookupTimer = 0;
let cepLookupSequence = 0;
let lastViaCepValues = { street: '', neighborhood: '', city: '', state: '' };

function formatPrice(priceCents) {
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) return 'Preço a confirmar';
  return money.format(priceCents / 100);
}

function hasPrice(product) {
  return Number.isSafeInteger(product.priceCents) && product.priceCents > 0;
}

function makeRequestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function checkoutRequestIdFor(productId) {
  const key = `${CHECKOUT_REQUEST_PREFIX}${productId}`;
  try {
    const existing = sessionStorage.getItem(key) || '';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
      return existing;
    }
    const requestId = makeRequestId();
    sessionStorage.setItem(key, requestId);
    return requestId;
  } catch {
    return makeRequestId();
  }
}

function clearCheckoutRequestId(productId) {
  try {
    sessionStorage.removeItem(`${CHECKOUT_REQUEST_PREFIX}${productId}`);
  } catch {
    // A tentativa atual permanece protegida pela chave mantida em memória.
  }
}

function ambiguousCheckout(productId) {
  try {
    return sessionStorage.getItem(`${AMBIGUOUS_CHECKOUT_PREFIX}${productId}`) || '';
  } catch {
    return '';
  }
}

function rememberAmbiguousCheckout(productId, orderId = '') {
  try {
    sessionStorage.setItem(`${AMBIGUOUS_CHECKOUT_PREFIX}${productId}`, orderId || 'verificar');
  } catch {
    // A trava de repetição em memória continua valendo até a página ser fechada.
  }
}

function appendSource(source) {
  if (!source?.title || !source?.url) return;
  try {
    const parsedUrl = new URL(source.url);
    if (parsedUrl.protocol !== 'https:') return;
    const link = document.createElement('a');
    link.href = parsedUrl.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = source.title;
    infoSources.append(link);
  } catch {
    // Ignora URLs inválidas; os textos do catálogo não devem criar links arbitrários.
  }
}

function openProductInfo(product) {
  infoTitle.textContent = product.name;
  infoPackage.textContent = `${product.dose} · Conteúdo: ${product.packageCount || 'quantidade não confirmada'}`;
  const details = [
    product.explanation || catalog.principle.explanation,
    product.researchUseDisclosure,
    product.packageNote,
    product.unitContent ? `Conteúdo por unidade: ${product.unitContent}` : '',
  ].filter(Boolean);
  infoBody.textContent = details.join('\n\n') || 'Não há informações verificadas disponíveis neste momento.';
  infoSources.replaceChildren();
  (product.sources || catalog.principle.sources || []).forEach(appendSource);
  (product.packageSources || []).forEach(appendSource);
  if (infoSources.childElementCount === 0) {
    const note = document.createElement('span');
    note.textContent = 'Fontes específicas em conferência.';
    infoSources.append(note);
  }
  infoDialog.showModal();
}

function setCheckoutError(message, retrySafe = true, productId = '', orderId = '') {
  checkoutError.textContent = message;
  checkoutError.hidden = false;
  checkoutSubmit.disabled = retrySafe !== true;
  checkoutSubmit.textContent = retrySafe === true ? 'Tentar novamente' : 'Verifique antes de repetir';
  if (retrySafe !== true && productId) rememberAmbiguousCheckout(productId, orderId);
}

function openCheckout(product) {
  if (!hasPrice(product)) return;
  checkoutDialog.classList.remove('pix-result-open');
  selectedProduct = product;
  checkoutRequestId = checkoutRequestIdFor(product.id);
  lastViaCepValues = { street: '', neighborhood: '', city: '', state: '' };
  checkoutForm.reset();
  checkoutForm.querySelector('[name="paymentMethod"][value="avista"]').checked = true;
  checkoutError.hidden = true;
  checkoutError.textContent = '';
  checkoutFormView.hidden = false;
  checkoutResult.hidden = true;
  checkoutSubmit.disabled = false;
  checkoutSubmit.textContent = 'Gerar PIX';
  lookupCepButton.disabled = false;
  cepStatus.textContent = 'O endereço será preenchido após informar um CEP válido.';
  copyPixButton.textContent = 'Copiar código PIX';
  pixCode.value = '';
  pixQrImage.removeAttribute('src');
  pixQrFigure.hidden = true;
  currentOrderId = '';
  checkPaymentButton.disabled = false;
  checkPaymentButton.textContent = 'Já paguei — verificar status';
  paymentCheckMessage.textContent = '';
  orderIdElement.textContent = '';
  transactionId.textContent = '';
  checkoutProductName.textContent = `${product.name} · ${product.dose}`;
  const packageText = product.packageCount ? `Conteúdo da caixa: ${product.packageCount}` : 'Conteúdo da caixa a confirmar';
  const priceUnit = product.priceUnit ? `por ${product.priceUnit}` : 'por caixa';
  const totalCents = product.priceCents + SHIPPING_CENTS;
  const total = formatPrice(totalCents);
  checkoutProductSummary.textContent = `${packageText}. Produto: ${formatPrice(product.priceCents)} ${priceUnit}. Frete fixo: ${formatPrice(SHIPPING_CENTS)}. Total do pedido: ${total}.`;
  updatePaymentSummary();
  checkoutPackageWarning.textContent = product.packageNote || '';
  checkoutPackageWarning.hidden = product.packageConfidence === 'official';
  researchUseDeclaration.hidden = !product.researchUseOnly;
  checkoutTermsDetails.open = false;

  const previousUncertainOrder = ambiguousCheckout(product.id);
  if (previousUncertainOrder) {
    setCheckoutError(
      `Uma solicitação anterior pode ter criado uma cobrança${previousUncertainOrder === 'verificar' ? '' : ` (pedido ${previousUncertainOrder})`}. Confira no painel Pixgate antes de tentar novamente.`,
      false,
      product.id,
      previousUncertainOrder,
    );
  }

  checkoutDialog.showModal();
  nameInput.focus();
}

function addProductCard(product, index) {
  const card = document.createElement('article');
  card.className = 'product-card';
  card.setAttribute('role', 'listitem');
  card.setAttribute('aria-posinset', String(index + 1));
  card.setAttribute('aria-setsize', String(catalog.products.length));

  const visual = document.createElement('div');
  visual.className = 'product-visual';
  const number = document.createElement('span');
  number.className = 'product-index';
  number.textContent = String(index + 1).padStart(2, '0');
  const image = document.createElement('img');
  image.src = product.image;
  image.alt = product.alt;
  image.loading = index > 2 ? 'lazy' : 'eager';
  if (index < 3) image.fetchPriority = 'high';
  visual.append(number, image);

  const detail = document.createElement('div');
  detail.className = 'product-detail';
  const type = document.createElement('p');
  type.className = 'product-type';
  type.textContent = product.category || `${catalog.principle.name} · Seleção Vitta`;
  const title = document.createElement('h3');
  title.textContent = product.name;
  const dose = document.createElement('p');
  dose.className = 'product-dose';
  dose.textContent = product.dose;
  const packageCount = document.createElement('p');
  packageCount.className = 'product-package';
  packageCount.textContent = product.packageCount ? `Conteúdo: ${product.packageCount}` : 'Conteúdo da caixa: a confirmar';
  if (product.packageConfidence !== 'official') packageCount.classList.add('product-package-unverified');
  const priceBlock = document.createElement('div');
  priceBlock.className = 'product-price-block';
  const priceInfo = document.createElement('div');
  const priceLabel = document.createElement('span');
  priceLabel.className = 'product-price-label';
  priceLabel.textContent = `Preço por ${product.priceUnit || 'caixa'}`;
  const price = document.createElement('strong');
  price.className = 'product-price';
  price.textContent = formatPrice(product.priceCents);
  const shipping = document.createElement('span');
  shipping.className = 'product-shipping-badge';
  shipping.textContent = 'Frete fixo R$ 30,00';
  priceInfo.append(priceLabel, price, shipping);
  priceBlock.append(priceInfo);

  const actions = document.createElement('div');
  actions.className = 'product-actions';
  const buy = document.createElement('button');
  buy.className = 'product-cta';
  buy.type = 'button';
  buy.innerHTML = `Comprar ${arrowIcon}`;
  const canBuy = hasPrice(product);
  buy.disabled = !canBuy;
  buy.title = canBuy ? '' : 'Preço ainda não confirmado; compra desabilitada.';
  buy.setAttribute('aria-label', canBuy ? `Comprar ${product.name}, ${product.dose}` : `${product.name}, preço a confirmar; compra desabilitada`);
  if (canBuy) buy.addEventListener('click', () => openCheckout(product));
  const more = document.createElement('button');
  more.className = 'product-info-button';
  more.type = 'button';
  more.textContent = 'Saiba mais';
  more.setAttribute('aria-label', `Ler sobre ${product.name}`);
  more.addEventListener('click', () => openProductInfo(product));
  actions.append(buy, more);

  detail.append(type, title, dose, packageCount, priceBlock, actions);
  card.append(visual, detail);
  track.append(card);
}

function updateCarousel() {
  const firstCard = track.querySelector('.product-card');
  if (!firstCard) return;
  const gap = Number.parseFloat(getComputedStyle(track).gap || '0');
  const cardStep = firstCard.getBoundingClientRect().width + gap;
  const visible = Math.max(1, Math.round((track.clientWidth + gap) / cardStep));
  const first = Math.min(catalog.products.length, Math.floor((track.scrollLeft + 3) / cardStep) + 1);
  const last = Math.min(catalog.products.length, first + visible - 1);
  carouselStatus.textContent = `${String(first).padStart(2, '0')}–${String(last).padStart(2, '0')} / ${String(catalog.products.length).padStart(2, '0')}`;
  previousButton.disabled = track.scrollLeft <= 2;
  nextButton.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
  const maxScroll = track.scrollWidth - track.clientWidth;
  const progress = maxScroll > 0 ? Math.max(0, Math.min(1, track.scrollLeft / maxScroll)) : 0;
  meter.style.transform = `scaleX(${Math.max(.34, progress)})`;
}

function moveCarousel(direction) {
  const firstCard = track.querySelector('.product-card');
  if (!firstCard) return;
  const gap = Number.parseFloat(getComputedStyle(track).gap || '0');
  track.scrollBy({ left: direction * (firstCard.getBoundingClientRect().width + gap), behavior: 'smooth' });
}

function detectDevice() {
  const userAgent = navigator.userAgent.toLowerCase();
  if (/android/.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/.test(userAgent)) return 'ios';
  return 'web';
}

function statusLabel(value) {
  const status = String(value || 'PENDING').toUpperCase();
  if (status === 'PAID') return 'Pagamento confirmado';
  if (status === 'PARTIALLY_PAID') return 'Entrada paga — saldo pendente';
  if (status === 'PENDING') return 'Pendente';
  if (status === 'UNKNOWN') return 'Em conferência';
  if (status === 'CREATING') return 'Gerando cobrança';
  return status;
}

function selectedPaymentMethod() {
  return checkoutForm.querySelector('[name="paymentMethod"]:checked')?.value || 'avista';
}

function updatePaymentSummary() {
  if (!selectedProduct || !paymentSummary) return;
  const totalCents = selectedProduct.priceCents + SHIPPING_CENTS;
  if (selectedPaymentMethod() === 'parcelado') {
    const depositCents = Math.floor((selectedProduct.priceCents * 35 + 50) / 100) + SHIPPING_CENTS;
    paymentSummary.textContent = `Total: ${formatPrice(totalCents)} · Pix agora: 35% do produto + frete fixo (${formatPrice(depositCents)}) · Próximas cobranças do saldo (${formatPrice(totalCents - depositCents)}) serão enviadas por e-mail e WhatsApp.`;
    return;
  }
  paymentSummary.textContent = `Total no Pix: ${formatPrice(totalCents)} (produto + frete fixo de R$ 30,00).`;
}

function currentCepDigits() {
  return cepInput.value.replace(/\D/g, '');
}

function formatCepInput() {
  const digits = currentCepDigits().slice(0, 8);
  cepInput.value = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

function fillFromViaCep(key, value) {
  const input = addressInputs[key];
  const previousValue = lastViaCepValues[key];
  const newValue = typeof value === 'string' ? value.trim() : '';
  if (!newValue) return;
  if (!input.value.trim() || input.value.trim() === previousValue) input.value = newValue;
  lastViaCepValues[key] = newValue;
}

async function lookupCep() {
  const digits = currentCepDigits();
  if (!/^\d{8}$/.test(digits)) {
    cepStatus.textContent = 'Digite um CEP válido com 8 números.';
    cepInput.focus();
    return;
  }

  const requestSequence = ++cepLookupSequence;
  lookupCepButton.disabled = true;
  cepStatus.textContent = 'Consultando o CEP…';
  try {
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error('Não foi possível consultar o CEP agora.');
    const data = await response.json();
    if (requestSequence !== cepLookupSequence || currentCepDigits() !== digits) return;
    if (data.erro) {
      cepStatus.textContent = 'CEP não encontrado. Confira o número e preencha o endereço manualmente.';
      return;
    }

    fillFromViaCep('street', data.logradouro || '');
    fillFromViaCep('neighborhood', data.bairro || '');
    fillFromViaCep('city', data.localidade || '');
    fillFromViaCep('state', data.uf || '');
    cepStatus.textContent = 'CEP encontrado. Revise o endereço; os campos permanecem editáveis.';
  } catch {
    if (requestSequence === cepLookupSequence) {
      cepStatus.textContent = 'Não foi possível consultar o CEP. Preencha ou revise o endereço manualmente.';
    }
  } finally {
    if (requestSequence === cepLookupSequence) lookupCepButton.disabled = false;
  }
}

function scheduleCepLookup() {
  window.clearTimeout(cepLookupTimer);
  const digits = currentCepDigits();
  if (digits.length !== 8) {
    cepStatus.textContent = digits.length ? 'Digite os 8 números do CEP para buscar o endereço.' : 'O endereço será preenchido após informar um CEP válido.';
    return;
  }
  cepStatus.textContent = 'CEP completo. Buscando endereço…';
  cepLookupTimer = window.setTimeout(lookupCep, 250);
}

async function submitCheckout(event) {
  event.preventDefault();
  checkoutError.hidden = true;
  checkoutError.textContent = '';
  if (!checkoutForm.reportValidity()) return;
  if (!selectedProduct) return;

  const nome = nameInput.value.trim().replace(/\s+/g, ' ');
  const cpf = cpfInput.value.replace(/\D/g, '');
  if (nome.split(' ').filter(Boolean).length < 2) {
    setCheckoutError('Informe seu nome completo.');
    nameInput.focus();
    return;
  }
  if (![11, 14].includes(cpf.length)) {
    setCheckoutError('Informe um CPF ou CNPJ com 11 ou 14 números.');
    cpfInput.focus();
    return;
  }
  if (!emailInput.value.trim()) {
    setCheckoutError('Informe um e-mail válido para sua conta.');
    emailInput.focus();
    return;
  }
  if (passwordInput.value.length < 6) {
    setCheckoutError('Crie uma senha com pelo menos 6 caracteres.');
    passwordInput.focus();
    return;
  }
  if (passwordConfirmationInput.value !== passwordInput.value) {
    setCheckoutError('A confirmação da senha não corresponde.');
    passwordConfirmationInput.focus();
    return;
  }
  if (!termsConsentInput.checked) {
    setCheckoutError('Aceite os termos de compra e privacidade para continuar.');
    termsConsentInput.focus();
    return;
  }
  if (whatsappMarketingConsentInput.checked && !phoneInput.value.trim()) {
    setCheckoutError('Informe seu telefone para receber ofertas pelo WhatsApp.');
    phoneInput.focus();
    return;
  }

  const address = {
    cep: cepInput.value.trim(),
    street: addressInputs.street.value.trim(),
    number: addressInputs.number.value.trim(),
    complement: addressInputs.complement.value.trim(),
    neighborhood: addressInputs.neighborhood.value.trim(),
    city: addressInputs.city.value.trim(),
    state: addressInputs.state.value.trim().toUpperCase(),
  };

  checkoutSubmit.disabled = true;
  checkoutSubmit.textContent = 'Registrando pedido…';
  try {
    const response = await fetch('/api/cashin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        productId: selectedProduct.id,
        paymentMethod: selectedPaymentMethod(),
        checkoutRequestId,
        nome,
        cpf,
        email: emailInput.value.trim(),
        phone: phoneInput.value.trim(),
        whatsappMarketingConsent: whatsappMarketingConsentInput.checked,
        password: passwordInput.value,
        passwordConfirmation: passwordConfirmationInput.value,
        device: detectDevice(),
        termsConsent: termsConsentInput.checked,
        address,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reference = result.transactionId ? ` Referência Pixgate: ${result.transactionId}.` : '';
      const error = new Error(`${result.error || 'Não foi possível registrar o pedido agora.'}${reference}`);
      error.retrySafe = result.retrySafe === true;
      error.orderId = result.orderId || '';
      throw error;
    }
    if (!result.pix || !result.orderId || !result.transactionId) {
      const error = new Error('A resposta não confirmou o pedido e o código PIX. Não tente novamente até verificar a cobrança.');
      error.retrySafe = false;
      error.orderId = result.orderId || '';
      throw error;
    }

    clearCheckoutRequestId(selectedProduct.id);
    checkoutFormView.hidden = true;
    checkoutResult.hidden = false;
    checkoutDialog.classList.add('pix-result-open');
    currentOrderId = result.orderId;
    const value = Number(result.value);
    const chargedAmount = Number.isFinite(value) ? money.format(value) : formatPrice(selectedProduct.priceCents + SHIPPING_CENTS);
    const fullTotal = Number.isFinite(Number(result.totalValue))
      ? money.format(Number(result.totalValue))
      : formatPrice(selectedProduct.priceCents + SHIPPING_CENTS);
    if (result.paymentMethod === 'parcelado') {
      const balance = Number.isFinite(Number(result.balanceValue)) ? money.format(Number(result.balanceValue)) : 'o saldo restante';
      pixStatusMessage.textContent = `Pedido registrado. O Pix gerado agora cobra 35% do valor do produto mais o frete fixo de R$ 30,00: ${chargedAmount}. O saldo restante não está nesta cobrança. Total do pedido: ${fullTotal}. Escaneie o QR Code ou use o código PIX para pagar a entrada.`;
      paymentFollowupNote.textContent = `As próximas cobranças do saldo (65% do produto, ${balance}) serão enviadas para seu e-mail e WhatsApp cadastrado. O frete de R$ 30,00 já está incluído na entrada.`;
      paymentFollowupNote.hidden = false;
    } else {
      pixStatusMessage.textContent = `Pedido registrado. Pix à vista de ${chargedAmount} criado (inclui frete fixo de R$ 30,00). Status atual: ${statusLabel(result.status)}. Escaneie o QR Code ou use o código PIX no aplicativo do seu banco.`;
      paymentFollowupNote.hidden = true;
      paymentFollowupNote.textContent = '';
    }
    orderIdElement.textContent = result.orderId;
    transactionId.textContent = result.transactionId;
    pixCode.value = result.pix;
    if (typeof result.qrCodeDataUrl === 'string' && result.qrCodeDataUrl.startsWith('data:image/png;base64,')) {
      pixQrImage.src = result.qrCodeDataUrl;
      pixQrFigure.hidden = false;
    } else {
      pixQrFigure.hidden = true;
      paymentCheckMessage.textContent = 'O código PIX copia e cola está disponível. Não foi possível montar a imagem QR agora; copie o código para pagar.';
    }
  } catch (error) {
    const canRetry = error.retrySafe === true;
    setCheckoutError(
      error.message || 'Não foi possível confirmar o pedido. Confira antes de tentar novamente.',
      canRetry,
      selectedProduct.id,
      error.orderId || '',
    );
  }
}

async function copyPixCode() {
  if (!pixCode.value) return;
  try {
    await navigator.clipboard.writeText(pixCode.value);
  } catch {
    pixCode.focus();
    pixCode.select();
    document.execCommand('copy');
  }
  copyPixButton.textContent = 'Código copiado';
}

async function checkPaymentStatus() {
  if (!currentOrderId) return;
  checkPaymentButton.disabled = true;
  checkPaymentButton.textContent = 'Consultando…';
  try {
    const response = await fetch(`/api/customer/orders/${encodeURIComponent(currentOrderId)}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.order) throw new Error(result.error || 'Não foi possível consultar o status agora.');
    if (result.order.paymentStatus === 'PAID') {
      paymentCheckMessage.textContent = 'Pagamento confirmado pela Pixgate. Obrigado!';
      checkPaymentButton.textContent = 'Pagamento confirmado';
      return;
    }
    paymentCheckMessage.textContent = `O pagamento ainda está ${statusLabel(result.order.paymentStatus).toLowerCase()}. Aguarde a confirmação da Pixgate e consulte novamente.`;
    checkPaymentButton.textContent = 'Já paguei — verificar status';
  } catch (error) {
    paymentCheckMessage.textContent = error.message || 'Não foi possível consultar o status agora.';
    checkPaymentButton.textContent = 'Tentar verificar novamente';
  } finally {
    checkPaymentButton.disabled = false;
  }
}

function bindDialogControls() {
  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  });
  whatsappFloatClose?.addEventListener('click', () => {
    whatsappFloat.hidden = true;
  });
  [infoDialog, checkoutDialog].forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

async function loadCatalog() {
  try {
    const response = await fetch('./catalog.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('O catálogo não está disponível neste momento.');
    catalog = await response.json();
    if (!Array.isArray(catalog.products) || catalog.products.length === 0) {
      throw new Error('Os dados do catálogo estão incompletos.');
    }
    const productIds = new Set(catalog.products.map((product) => product.id));
    if (productIds.size !== catalog.products.length) throw new Error('Os dados do catálogo contêm produtos duplicados.');
    const total = String(catalog.products.length).padStart(2, '0');
    document.querySelectorAll('[data-catalog-count]').forEach((element) => { element.textContent = total; });
    track.replaceChildren();
    catalog.products.forEach(addProductCard);
    previousButton.addEventListener('click', () => moveCarousel(-1));
    nextButton.addEventListener('click', () => moveCarousel(1));
    track.addEventListener('scroll', () => requestAnimationFrame(updateCarousel), { passive: true });
    window.addEventListener('resize', updateCarousel);
    checkoutForm.addEventListener('submit', submitCheckout);
    checkoutForm.querySelectorAll('[name="paymentMethod"]').forEach((input) => input.addEventListener('change', updatePaymentSummary));
    copyPixButton.addEventListener('click', copyPixCode);
    checkPaymentButton.addEventListener('click', checkPaymentStatus);
    lookupCepButton.addEventListener('click', lookupCep);
    cepInput.addEventListener('input', () => {
      formatCepInput();
      scheduleCepLookup();
    });
    cepInput.addEventListener('change', lookupCep);
    cepInput.addEventListener('blur', () => {
      if (/^\d{8}$/.test(currentCepDigits())) lookupCep();
    });
    bindDialogControls();
    updateCarousel();
  } catch {
    carouselStatus.textContent = 'Catálogo indisponível';
    track.setAttribute('aria-busy', 'false');
  }
}

loadCatalog();
