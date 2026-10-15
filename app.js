const products = [
  {
    name: 'Lipoless',
    dose: 'Tirzepatida · 15 mg',
    priceLabel: 'Preço de referência',
    price: 'R$ 484,23',
    image: './images/lipoless.png',
    alt: 'Embalagem Lipoless 15 mg do Laboratório Eticos',
  },
  {
    name: 'Tirzec',
    dose: 'Tirzepatida · 15 mg',
    priceLabel: 'Preço de referência',
    price: 'R$ 484,23',
    image: './images/tirzec.png',
    alt: 'Embalagem Tirzec 15 mg da Quimfa',
  },
  {
    name: 'Gluconex',
    dose: 'Tirzepatida · 15 mg · 4 frascos',
    priceLabel: 'Faixa de referência',
    price: 'R$ 495,20 – R$ 540,00',
    image: './images/gluconex.jpg',
    alt: 'Caixa Gluconex 15 mg com quatro frascos da Lasca',
  },
  {
    name: 'Tirzedral',
    dose: 'Tirzepatida · 5 mg',
    priceLabel: 'Preço de referência',
    price: 'R$ 302,65',
    image: './images/tirzedral.jpg',
    alt: 'Caixa Tirzedral 5 mg do Laboratório Catedral',
  },
  {
    name: 'Slimex',
    dose: 'Tirzepatida · 15 mg · 4 frascos',
    priceLabel: 'Faixa de referência',
    price: 'R$ 484,69 – R$ 495,72',
    image: './images/slimex.jpg',
    alt: 'Embalagem Slimex 15 mg com quatro frascos',
  },
  {
    name: 'T.G. 15mg',
    dose: 'Tirzepatida · 15 mg · 4 frascos',
    priceLabel: 'Preço de referência',
    price: 'R$ 544,76',
    image: './images/tg15.jpg',
    alt: 'Embalagem T.G. 15 mg com quatro frascos da Indufar',
  },
];

const phone = '5545991013749';
const track = document.querySelector('#products-track');
const previousButton = document.querySelector('#carousel-prev');
const nextButton = document.querySelector('#carousel-next');
const status = document.querySelector('#carousel-status');
const meter = document.querySelector('#scroll-meter-fill');
const arrowIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M10 5l5 5-5 5" /></svg>';

products.forEach((product, index) => {
  const card = document.createElement('article');
  const message = encodeURIComponent(`Olá, Vitta Farm! Quero consultar ${product.name} (${product.dose}).`);
  card.className = 'product-card';
  card.setAttribute('role', 'listitem');
  card.setAttribute('aria-posinset', String(index + 1));
  card.setAttribute('aria-setsize', String(products.length));
  card.innerHTML = `
    <div class="product-visual">
      <span class="product-index">${String(index + 1).padStart(2, '0')}</span>
      <img src="${product.image}" alt="${product.alt}" ${index > 2 ? 'loading="lazy"' : 'fetchpriority="high"'} />
    </div>
    <div class="product-detail">
      <p class="product-type">Tirzepatida <span>·</span> Seleção Vitta</p>
      <h3>${product.name}</h3>
      <p class="product-dose">${product.dose}</p>
      <div class="product-price-block">
        <div><span class="product-price-label">${product.priceLabel}</span><strong class="product-price">${product.price}</strong></div>
        <a class="product-cta" href="https://wa.me/${phone}?text=${message}" target="_blank" rel="noopener noreferrer" aria-label="Consultar ${product.name} pelo WhatsApp">Consultar <span class="cta-wide">no WhatsApp</span>${arrowIcon}</a>
      </div>
    </div>`;
  track.append(card);
});

function updateCarousel() {
  const firstCard = track.querySelector('.product-card');
  if (!firstCard) return;
  const cardStep = firstCard.getBoundingClientRect().width + Number.parseFloat(getComputedStyle(track).gap || '0');
  const visible = Math.max(1, Math.round((track.clientWidth + Number.parseFloat(getComputedStyle(track).gap || '0')) / cardStep));
  const first = Math.min(products.length, Math.floor((track.scrollLeft + 3) / cardStep) + 1);
  const last = Math.min(products.length, first + visible - 1);
  status.textContent = `${String(first).padStart(2, '0')}–${String(last).padStart(2, '0')} / ${String(products.length).padStart(2, '0')}`;
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

previousButton.addEventListener('click', () => moveCarousel(-1));
nextButton.addEventListener('click', () => moveCarousel(1));
track.addEventListener('scroll', () => requestAnimationFrame(updateCarousel), { passive: true });
window.addEventListener('resize', updateCarousel);
updateCarousel();
