const loginView = document.querySelector('#admin-login-view');
const customersView = document.querySelector('#admin-customers-view');
const loginForm = document.querySelector('#admin-login-form');
const passwordInput = document.querySelector('#admin-password');
const passwordToggleButton = document.querySelector('#admin-password-toggle');
const passwordCount = document.querySelector('#admin-password-count');
const loginButton = document.querySelector('#admin-login-button');
const loginMessage = document.querySelector('#admin-login-message');
const customersMessage = document.querySelector('#admin-customers-message');
const customersBody = document.querySelector('#admin-customers-body');
const refreshCustomersButton = document.querySelector('#refresh-customers');
const logoutButton = document.querySelector('#admin-logout');
const searchInput = document.querySelector('#customer-search');
const orderFilter = document.querySelector('#customer-order-filter');
const marketingFilter = document.querySelector('#customer-marketing-filter');
let allCustomers = [];

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

function updatePasswordCount() {
  const length = passwordInput.value.length;
  passwordCount.textContent = `${length} caractere${length === 1 ? '' : 's'}`;
}

function setPasswordVisibility(visible) {
  passwordInput.type = visible ? 'text' : 'password';
  passwordToggleButton.setAttribute('aria-pressed', String(visible));
  passwordToggleButton.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
}

passwordInput.addEventListener('input', updatePasswordCount);
passwordToggleButton.addEventListener('click', () => setPasswordVisibility(passwordInput.type === 'password'));
updatePasswordCount();

function showLogin(message = '', isError = false) {
  loginView.hidden = false;
  customersView.hidden = true;
  passwordInput.value = '';
  updatePasswordCount();
  setPasswordVisibility(false);
  setMessage(loginMessage, message, isError);
}

function showCustomers() {
  loginView.hidden = true;
  customersView.hidden = false;
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

function paymentLabel(status) {
  const normalized = String(status || 'NO_ORDER').toUpperCase();
  const labels = {
    NO_ORDER: 'Sem pedido enviado',
    CREATING: 'Solicitação recebida',
    PENDING: 'Aguardando Pix',
    UNKNOWN: 'Em conferência',
    PAID: 'Pagamento confirmado',
  };
  return { normalized, label: labels[normalized] || 'Em conferência' };
}

function createCustomerRow(customer) {
  const row = document.createElement('tr');
  const name = customer.displayName || 'Nome não informado';
  const email = customer.email || '';
  const phone = String(customer.phone || '');
  const digits = phone.replace(/\D/g, '');
  const { normalized, label } = paymentLabel(customer.lastOrderStatus);
  row.dataset.paymentStatus = normalized.toLowerCase().replaceAll('_', '-');
  row.dataset.marketingAuthorized = customer.whatsappMarketingConsent ? 'true' : 'false';
  row.dataset.search = `${name} ${email} ${phone} ${customer.lastOrderProductName || ''}`.toLocaleLowerCase('pt-BR');

  addCell(row, name);
  addCell(row, email);

  const phoneCell = document.createElement('td');
  if (customer.whatsappMarketingConsent && /^55\d{10,11}$/.test(digits)) {
    const link = document.createElement('a');
    link.href = `https://wa.me/${digits}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = phone;
    link.setAttribute('aria-label', `Abrir WhatsApp autorizado de ${name || email}`);
    phoneCell.append(link);
  } else {
    phoneCell.textContent = phone || '—';
  }
  row.append(phoneCell);

  addCell(row, customer.lastOrderProductName || '—');
  const statusCell = document.createElement('td');
  const status = document.createElement('span');
  status.className = `admin-status admin-status-${normalized.toLowerCase().replaceAll('_', '-')}`;
  status.textContent = label;
  statusCell.append(status);
  row.append(statusCell);
  addCell(row, String(customer.orderCount ?? 0));
  addCell(row, dateLabel(customer.createdAt));
  addCell(row, customer.whatsappMarketingConsent
    ? `Autorizou em ${dateLabel(customer.consentAt)}`
    : 'Não autorizou');
  return row;
}

function renderCustomers() {
  const query = searchInput.value.trim().toLocaleLowerCase('pt-BR');
  const paymentSelection = orderFilter.value;
  const marketingSelection = marketingFilter.value;
  const filtered = allCustomers.filter((customer) => {
    const { normalized } = paymentLabel(customer.lastOrderStatus);
    const status = normalized.toLowerCase().replaceAll('_', '-');
    const hasPayment = normalized === 'PAID';
    const noOrder = normalized === 'NO_ORDER';
    if (paymentSelection === 'open' && hasPayment) return false;
    if (paymentSelection === 'paid' && !hasPayment) return false;
    if (paymentSelection === 'no-order' && !noOrder) return false;
    if (marketingSelection === 'authorized' && !customer.whatsappMarketingConsent) return false;
    const searchable = `${customer.displayName || ''} ${customer.email || ''} ${customer.phone || ''} ${customer.lastOrderProductName || ''}`.toLocaleLowerCase('pt-BR');
    return !query || searchable.includes(query) || status.includes(query);
  });

  customersBody.replaceChildren();
  if (filtered.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 8;
    cell.className = 'admin-empty-state';
    cell.textContent = allCustomers.length === 0
      ? 'Nenhum cliente cadastrado ainda.'
      : 'Nenhum cliente corresponde aos filtros.';
    row.append(cell);
    customersBody.append(row);
  } else {
    filtered.forEach((customer) => customersBody.append(createCustomerRow(customer)));
  }

  const openCount = allCustomers.filter((customer) => paymentLabel(customer.lastOrderStatus).normalized !== 'PAID').length;
  setMessage(customersMessage, `${filtered.length} de ${allCustomers.length} cliente${allCustomers.length === 1 ? '' : 's'} exibido${allCustomers.length === 1 ? '' : 's'} · ${openCount} sem pagamento confirmado.`);
}

async function loadCustomers() {
  refreshCustomersButton.disabled = true;
  setMessage(customersMessage, 'Carregando clientes…');
  try {
    const result = await api('/api/admin/customers', { method: 'GET' });
    allCustomers = Array.isArray(result.customers) ? result.customers : [];
    renderCustomers();
  } catch (error) {
    if (/sessão|autenticação/i.test(error.message)) return showLogin('Sua sessão expirou. Entre novamente.', true);
    setMessage(customersMessage, error.message || 'Não foi possível carregar os clientes.', true);
  } finally {
    refreshCustomersButton.disabled = false;
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
    updatePasswordCount();
    setPasswordVisibility(false);
    showCustomers();
    await loadCustomers();
  } catch (error) {
    setMessage(loginMessage, error.message || 'Não foi possível entrar.', true);
    passwordInput.select();
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Entrar';
  }
});

searchInput.addEventListener('input', renderCustomers);
orderFilter.addEventListener('change', renderCustomers);
marketingFilter.addEventListener('change', renderCustomers);
refreshCustomersButton.addEventListener('click', loadCustomers);
logoutButton.addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method: 'POST' });
  } catch {
    // A tela de login remove os dados visíveis mesmo se a sessão já tiver expirado.
  }
  allCustomers = [];
  customersBody.replaceChildren();
  showLogin('Você saiu do painel.');
});

async function initialize() {
  try {
    await api('/api/admin/session', { method: 'GET' });
    showCustomers();
    await loadCustomers();
  } catch {
    showLogin();
  }
}

initialize();
