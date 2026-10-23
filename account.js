const loginPanel = document.querySelector('#account-login-panel');
const ordersPanel = document.querySelector('#account-orders-panel');
const loginForm = document.querySelector('#account-login-form');
const loginButton = document.querySelector('#account-login-button');
const loginMessage = document.querySelector('#account-login-message');
const ordersMessage = document.querySelector('#account-orders-message');
const ordersList = document.querySelector('#account-order-list');
const emailLabel = document.querySelector('#account-email-label');
const logoutButton = document.querySelector('#account-logout');
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function setMessage(element, message = '', isError = false) {
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('is-error', Boolean(message) && isError);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.');
  return data;
}

function statusText(value) {
  const status = String(value || 'PENDING').toUpperCase();
  if (status === 'PAID') return 'Pagamento confirmado';
  if (status === 'UNKNOWN') return 'Em conferência';
  if (status === 'CREATING') return 'Gerando cobrança';
  return 'Aguardando pagamento';
}

function renderOrders(orders) {
  ordersList.replaceChildren();
  if (!orders.length) {
    const empty = document.createElement('p');
    empty.className = 'account-empty';
    empty.textContent = 'Ainda não há pedidos vinculados a esta conta.';
    ordersList.append(empty);
    return;
  }

  for (const order of orders) {
    const card = document.createElement('article');
    card.className = 'account-order';
    const heading = document.createElement('div');
    heading.className = 'account-order-heading';
    const title = document.createElement('h3');
    title.textContent = order.productName;
    const status = document.createElement('span');
    status.className = `account-order-status${order.paymentStatus === 'PAID' ? ' is-paid' : ''}`;
    status.textContent = statusText(order.paymentStatus);
    heading.append(title, status);
    const details = document.createElement('p');
    const date = new Date(order.createdAt);
    const dateLabel = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR');
    details.textContent = `${money.format(order.totalCents / 100)}${dateLabel ? ` · ${dateLabel}` : ''}`;
    card.append(heading, details);
    ordersList.append(card);
  }
}

async function loadOrders(customer) {
  loginPanel.hidden = true;
  ordersPanel.hidden = false;
  emailLabel.textContent = customer.email;
  setMessage(ordersMessage, 'Carregando seus pedidos…');
  try {
    const data = await api('/api/customer/orders');
    renderOrders(data.orders || []);
    setMessage(ordersMessage, 'Os pagamentos são confirmados automaticamente pela Pixgate.');
  } catch (error) {
    setMessage(ordersMessage, error.message || 'Não foi possível carregar seus pedidos.', true);
  }
}

async function restoreSession() {
  try {
    const data = await api('/api/customer/session');
    if (data.authenticated && data.customer) await loadOrders(data.customer);
  } catch {
    // A tela de login é o estado padrão quando não há uma sessão válida.
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(loginMessage);
  if (!loginForm.reportValidity()) return;
  loginButton.disabled = true;
  loginButton.textContent = 'Entrando…';
  try {
    const data = await api('/api/customer/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.querySelector('#account-email').value,
        password: document.querySelector('#account-password').value,
      }),
    });
    loginForm.reset();
    await loadOrders(data.customer);
  } catch (error) {
    setMessage(loginMessage, error.message || 'Confira seu e-mail e senha e tente novamente.', true);
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Entrar';
  }
});

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    await api('/api/customer/logout', { method: 'POST', body: JSON.stringify({}) });
  } catch {
    // A sessão poderá expirar naturalmente se o banco estiver indisponível.
  }
  ordersPanel.hidden = true;
  loginPanel.hidden = false;
  logoutButton.disabled = false;
});

restoreSession();
