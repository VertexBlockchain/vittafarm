const loginView = document.querySelector('#admin-login-view');
const ordersView = document.querySelector('#admin-orders-view');
const loginForm = document.querySelector('#admin-login-form');
const passwordInput = document.querySelector('#admin-password');
const loginButton = document.querySelector('#admin-login-button');
const loginMessage = document.querySelector('#admin-login-message');
const ordersMessage = document.querySelector('#admin-orders-message');
const ordersBody = document.querySelector('#admin-orders-body');
const refreshButton = document.querySelector('#refresh-orders');
const logoutButton = document.querySelector('#admin-logout');
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('admin-message-error', Boolean(message) && isError);
  element.classList.toggle('admin-message-success', Boolean(message) && !isError);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a solicitação.');
  return result;
}

function showLogin(message = '', isError = false) {
  loginView.hidden = false;
  ordersView.hidden = true;
  passwordInput.value = '';
  setMessage(loginMessage, message, isError);
}

function showOrders() {
  loginView.hidden = true;
  ordersView.hidden = false;
  setMessage(loginMessage, '');
}

function addCell(row, text, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = text || '—';
  row.append(cell);
  return cell;
}

function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Data indisponível' : date.toLocaleString('pt-BR');
}

function addressLabel(address) {
  const street = [address.street, address.number].filter(Boolean).join(', ');
  const locality = [address.neighborhood, `${address.city}/${address.state}`].filter(Boolean).join(' · ');
  return [street, address.complement, locality, `CEP ${address.cep}`].filter(Boolean).join('\n');
}

function statusLabel(status) {
  const normalized = String(status || 'UNKNOWN').toUpperCase();
  const labels = { CREATING: 'Em conferência', PENDING: 'Pendente', UNKNOWN: 'Verificar manualmente', PAID: 'Pagamento confirmado' };
  return labels[normalized] || 'Verificar manualmente';
}

function createOrderRow(order) {
  const row = document.createElement('tr');
  const orderCell = addCell(row, `#${String(order.id).slice(0, 8)}\n${dateLabel(order.createdAt)}`, 'admin-order-reference');
  orderCell.title = order.id;
  addCell(row, `${order.productName} ${order.productDose}\n${order.productPackaging}`, 'admin-product-cell');
  addCell(row, order.payerName);
  const address = addressLabel(order.address);
  const addressCell = addCell(row, address, 'admin-address-cell');
  addressCell.setAttribute('aria-label', address.replace(/\n/g, ', '));
  addCell(row, `${money.format(order.totalCents / 100)}\nEnvio grátis`, 'admin-total-cell');

  const statusCell = document.createElement('td');
  const status = document.createElement('span');
  const normalizedStatus = String(order.paymentStatus || 'UNKNOWN').toLowerCase();
  status.className = `admin-status admin-status-${normalizedStatus}`;
  status.textContent = statusLabel(order.paymentStatus);
  statusCell.append(status);
  row.append(statusCell);
  addCell(row, order.transactionId || 'Aguardando conferência', 'admin-transaction-cell');
  return row;
}

async function loadOrders() {
  refreshButton.disabled = true;
  setMessage(ordersMessage, 'Carregando pedidos…');
  try {
    const result = await api('/api/admin/orders', { method: 'GET' });
    const orders = Array.isArray(result.orders) ? result.orders : [];
    ordersBody.replaceChildren();
    if (orders.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.className = 'admin-empty-state';
      cell.textContent = 'Nenhum pedido registrado.';
      row.append(cell);
      ordersBody.append(row);
      setMessage(ordersMessage, '0 pedidos');
    } else {
      orders.forEach((order) => ordersBody.append(createOrderRow(order)));
      setMessage(ordersMessage, `${orders.length} pedido${orders.length === 1 ? '' : 's'} carregado${orders.length === 1 ? '' : 's'}.`);
    }
  } catch (error) {
    if (/sessão|autenticação/i.test(error.message)) return showLogin('Sua sessão expirou. Entre novamente.', true);
    setMessage(ordersMessage, error.message || 'Não foi possível carregar os pedidos.', true);
  } finally {
    refreshButton.disabled = false;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(loginMessage, '');
  loginButton.disabled = true;
  loginButton.textContent = 'Validando…';
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: passwordInput.value }) });
    passwordInput.value = '';
    showOrders();
    await loadOrders();
  } catch (error) {
    setMessage(loginMessage, error.message || 'Não foi possível entrar.', true);
    passwordInput.select();
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Entrar';
  }
});

refreshButton.addEventListener('click', loadOrders);
logoutButton.addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method: 'POST' });
  } catch {
    // A tela de login remove o conteúdo visível mesmo se a sessão já tiver expirado.
  }
  ordersBody.replaceChildren();
  showLogin('Você saiu do painel.');
});

async function initialize() {
  try {
    await api('/api/admin/session', { method: 'GET' });
    showOrders();
    await loadOrders();
  } catch {
    showLogin();
  }
}

initialize();
