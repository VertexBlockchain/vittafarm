const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const track = document.querySelector('#products-track');
const previousButton = document.querySelector('#carousel-prev');
const nextButton = document.querySelector('#carousel-next');
const carouselStatus = document.querySelector('#carousel-status');
const meter = document.querySelector('#scroll-meter-fill');
const infoDialog = document.querySelector('#product-info-dialog');
const checkoutDialog = document.querySelector('#checkout-dialog');
const infoTitle = document.querySelector('#product-info-title');
const infoPackage = document.querySelector('#product-info-package');
const infoBody = document.querySelector('#product-info-body');
const infoSources = document.querySelector('#product-info-sources');
const checkoutForm = document.querySelector('#checkout-form');
const checkoutFormView = document.querySelector('#checkout-form-view');
const checkoutProductName = document.querySelector('#checkout-product-name');
const checkoutProductSummary = document.querySelector('#checkout-product-summary');
const checkoutPackageWarning = document.querySelector('#checkout-package-warning');
const checkoutError = document.querySelector('#checkout-error');
const checkoutSubmit = document.querySelector('#checkout-submit');
const checkoutResult = document.querySelector('#pix-result');
const pixStatusMessage = document.querySelector('#pix-status-message');
const transactionId = document.querySelector('#transaction-id');
const pixCode = document.querySelector('#pix-code');
const copyPixButton = document.querySelector('#copy-pix');
const nameInput = document.querySelector('#customer-name');
const cpfInput = document.querySelector('#customer-cpf');
const consentInput = document.querySelector('#pix-consent');
const arrowIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M10 5l5 5-5 5" /></svg>';

let catalog = null;
let selectedProduct = null;

function formatPrice(priceCents) {
  return money.format(priceCents / 100);
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
    catalog.principle.explanation,
    product.packageNote,
    product.unitContent ? `Conteúdo por unidade: ${product.unitContent}` : '',
  ].filter(Boolean);
  infoBody.textContent = details.join('\n\n') || 'Não há informações verificadas disponíveis neste momento.';
  infoSources.replaceChildren();
  (catalog.principle.sources || []).forEach(appendSource);
  (product.packageSources || []).forEach(appendSource);
  if (infoSources.childElementCount === 0) {
    const note = document.createElement('span');
    note.textContent = 'Fontes específicas em conferência.';
    infoSources.append(note);
  }
  infoDialog.showModal();
}

function openCheckout(product) {
  selectedProduct = product;
  checkoutForm.reset();
  checkoutError.hidden = true;
  checkoutError.textContent = '';
  checkoutFormView.hidden = false;
  checkoutResult.hidden = true;
  checkoutSubmit.disabled = false;
  checkoutSubmit.textContent = 'Gerar PIX';
  copyPixButton.textContent = 'Copiar código PIX';
  checkoutProductName.textContent = `${product.name} · ${product.dose}`;
  const packageText = product.packageCount ? `Conteúdo da caixa: ${product.packageCount}` : 'Conteúdo da caixa a confirmar';
  checkoutProductSummary.textContent = `${packageText}. Valor: ${formatPrice(product.priceCents)} por caixa.`;
  checkoutPackageWarning.textContent = product.packageNote || '';
  checkoutPackageWarning.hidden = product.packageConfidence === 'official';
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
  type.textContent = 'Tirzepatida · Seleção Vitta';
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
  priceLabel.textContent = 'Preço por caixa';
  const price = document.createElement('strong');
  price.className = 'product-price';
  price.textContent = formatPrice(product.priceCents);
  priceInfo.append(priceLabel, price);
  priceBlock.append(priceInfo);

  const actions = document.createElement('div');
  actions.className = 'product-actions';
  const buy = document.createElement('button');
  buy.className = 'product-cta';
  buy.type = 'button';
  buy.innerHTML = `Comprar ${arrowIcon}`;
  buy.setAttribute('aria-label', `Comprar ${product.name}, ${product.dose}`);
  buy.addEventListener('click', () => openCheckout(product));
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
  return status === 'PENDING' ? 'Pendente' : status;
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
    checkoutError.textContent = 'Informe seu nome completo.';
    checkoutError.hidden = false;
    nameInput.focus();
    return;
  }
  if (![11, 14].includes(cpf.length)) {
    checkoutError.textContent = 'Informe um CPF ou CNPJ com 11 ou 14 números.';
    checkoutError.hidden = false;
    cpfInput.focus();
    return;
  }
  if (!consentInput.checked) {
    checkoutError.textContent = 'Confirme o envio dos dados à Pixgate para gerar o PIX.';
    checkoutError.hidden = false;
    consentInput.focus();
    return;
  }

  checkoutSubmit.disabled = true;
  checkoutSubmit.textContent = 'Gerando PIX…';
  try {
    const response = await fetch('/api/cashin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: selectedProduct.id,
        nome,
        cpf,
        device: detectDevice(),
        consent: true,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reference = result.transactionId ? ` Referência Pixgate: ${result.transactionId}.` : '';
      const error = new Error(`${result.error || 'Não foi possível gerar o PIX agora.'}${reference}`);
      error.retrySafe = response.status >= 400 && response.status < 500;
      throw error;
    }
    if (!result.pix) {
      const error = new Error('A resposta da Pixgate não trouxe o código PIX. Verifique o status antes de tentar novamente, para evitar duplicidade.');
      error.retrySafe = false;
      throw error;
    }

    checkoutFormView.hidden = true;
    checkoutResult.hidden = false;
    const value = Number(result.value);
    const chargedAmount = Number.isFinite(value) ? money.format(value) : formatPrice(selectedProduct.priceCents);
    pixStatusMessage.textContent = `Cobrança de ${chargedAmount} criada. Status atual: ${statusLabel(result.status)}. Use o código no aplicativo do seu banco.`;
    transactionId.textContent = result.transactionId || 'Não informado';
    pixCode.value = result.pix;
  } catch (error) {
    checkoutError.textContent = error.message || 'Não foi possível gerar o PIX agora. Tente novamente mais tarde.';
    checkoutError.hidden = false;
    checkoutSubmit.disabled = error.retrySafe !== true;
    checkoutSubmit.textContent = error.retrySafe === true ? 'Tentar novamente' : 'Verifique antes de repetir';
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

function bindDialogControls() {
  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
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
    if (!Array.isArray(catalog.products) || catalog.products.length !== 6) {
      throw new Error('Os dados do catálogo estão incompletos.');
    }
    track.replaceChildren();
    catalog.products.forEach(addProductCard);
    previousButton.addEventListener('click', () => moveCarousel(-1));
    nextButton.addEventListener('click', () => moveCarousel(1));
    track.addEventListener('scroll', () => requestAnimationFrame(updateCarousel), { passive: true });
    window.addEventListener('resize', updateCarousel);
    checkoutForm.addEventListener('submit', submitCheckout);
    copyPixButton.addEventListener('click', copyPixCode);
    bindDialogControls();
    updateCarousel();
  } catch {
    carouselStatus.textContent = 'Catálogo indisponível';
    track.setAttribute('aria-busy', 'false');
  }
}

loadCatalog();
