const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CustomerAuthError,
  authenticateCustomer,
  createCustomerSession,
  customerSessionCookie,
  getCustomerForSession,
  newCustomerSessionToken,
  readCustomerSessionToken,
  revokeWhatsappMarketingConsent,
} = require('../src/customer-auth');

function customerPool() {
  const state = { account: null, sessions: [] };
  return {
    state,
    async execute(sql, params = []) {
      const statement = sql.trimStart();
      if (statement.startsWith('SELECT id, email, display_name, password_salt, password_hash')) {
        return [[state.account && state.account.email === params[0] ? state.account : null].filter(Boolean), []];
      }
      if (statement.startsWith('INSERT INTO customer_accounts')) {
        if (state.account) throw Object.assign(new Error('duplicate'), { code: '23505' });
        const [id, email, display_name, password_salt, password_hash, phone, optedIn] = params;
        state.account = {
          id, email, display_name, password_salt, password_hash, phone,
          whatsapp_marketing_consent_at: optedIn ? new Date() : null,
          whatsapp_marketing_revoked_at: null,
        };
        return [[], []];
      }
      if (statement.startsWith('UPDATE customer_accounts')) {
        if (statement.includes('SET phone = ?')) {
          const [phone, optedIn, , customerId] = params;
          if (state.account?.id === customerId) {
            state.account.phone = phone;
            if (optedIn) {
              state.account.whatsapp_marketing_consent_at = state.account.whatsapp_marketing_consent_at || new Date();
              state.account.whatsapp_marketing_revoked_at = null;
            }
          }
        } else {
          const [customerId] = params;
          if (state.account?.id === customerId) {
            state.account.whatsapp_marketing_consent_at = null;
            state.account.whatsapp_marketing_revoked_at = new Date();
          }
        }
        return [[], []];
      }
      if (statement.startsWith('DELETE FROM customer_sessions')) {
        state.sessions = [];
        return [[], []];
      }
      if (statement.startsWith('INSERT INTO customer_sessions')) {
        const [session_hash, customer_id] = params;
        state.sessions.push({ session_hash, customer_id });
        return [[], []];
      }
      if (statement.startsWith('SELECT customers.id, customers.email, customers.display_name')) {
        const session = state.sessions.find((item) => item.session_hash === params[0]);
        return [[session && state.account && session.customer_id === state.account.id ? {
          id: state.account.id,
          email: state.account.email,
          display_name: state.account.display_name,
          phone: state.account.phone,
          whatsapp_marketing_consent_at: state.account.whatsapp_marketing_consent_at,
        } : null].filter(Boolean), []];
      }
      throw new Error(`Consulta inesperada: ${statement.slice(0, 50)}`);
    },
  };
}

test('cria conta com telefone de pedido, senha de seis dígitos e hash no banco', async () => {
  const pool = customerPool();
  const created = await authenticateCustomer(pool, {
    email: '  Cliente@Example.com ',
    password: '123456',
    displayName: 'Cliente de Teste',
    phone: '(47) 92000-6015',
    allowCreate: true,
  });
  assert.equal(created.created, true);
  assert.equal(created.email, 'cliente@example.com');
  assert.equal(created.phone, '+5547920006015');
  assert.equal(created.whatsappMarketingConsent, false);
  assert.equal(pool.state.account.phone, '+5547920006015');
  assert.notEqual(pool.state.account.password_hash, '123456');
  assert.notEqual(pool.state.account.password_salt, '123456');

  const signedIn = await authenticateCustomer(pool, {
    email: 'CLIENTE@example.com',
    password: '123456',
    allowCreate: false,
  });
  assert.equal(signedIn.id, created.id);
  assert.equal(signedIn.created, false);
});

test('separa o telefone de contato da autorização para ofertas', async () => {
  const pool = customerPool();
  const customer = await authenticateCustomer(pool, {
    email: 'cliente@example.com',
    password: '123456',
    phone: '(47) 92000-6015',
    whatsappMarketingConsent: true,
    allowCreate: true,
  });
  assert.equal(customer.phone, '+5547920006015');
  assert.equal(customer.whatsappMarketingConsent, true);
  assert.equal(pool.state.account.phone, '+5547920006015');
  assert.ok(pool.state.account.whatsapp_marketing_consent_at);

  const reconsented = await authenticateCustomer(pool, {
    email: 'cliente@example.com',
    password: '123456',
    phone: '+55 47 99999-1111',
    whatsappMarketingConsent: true,
    allowCreate: true,
  });
  assert.equal(reconsented.phone, '+5547999991111');
  assert.equal(pool.state.account.phone, '+5547999991111');
});

test('revogar ofertas mantém o telefone do pedido e desativa o consentimento vigente', async () => {
  const pool = customerPool();
  const customer = await authenticateCustomer(pool, {
    email: 'cliente@example.com',
    password: '123456',
    phone: '(47) 92000-6015',
    whatsappMarketingConsent: true,
    allowCreate: true,
  });
  await revokeWhatsappMarketingConsent(pool, customer.id);
  assert.equal(pool.state.account.phone, '+5547920006015');
  assert.equal(pool.state.account.whatsapp_marketing_consent_at, null);
  assert.ok(pool.state.account.whatsapp_marketing_revoked_at);
});

test('não cria contas no login, exige senha correta e recusa senhas menores que seis caracteres', async () => {
  const pool = customerPool();
  await assert.rejects(
    authenticateCustomer(pool, { email: 'novo@example.com', password: '123456', allowCreate: false }),
    (error) => error instanceof CustomerAuthError && error.code === 'INVALID_CREDENTIALS',
  );
  await authenticateCustomer(pool, { email: 'cliente@example.com', password: '123456', phone: '(47) 92000-6015', allowCreate: true });
  await assert.rejects(
    authenticateCustomer(pool, { email: 'cliente@example.com', password: '654321', allowCreate: false }),
    (error) => error instanceof CustomerAuthError && error.code === 'INVALID_CREDENTIALS',
  );
  await assert.rejects(
    authenticateCustomer(pool, { email: 'novo@example.com', password: '12345', allowCreate: true }),
    (error) => error instanceof CustomerAuthError && error.code === 'INVALID_CREDENTIALS',
  );
});

test('sessão usa token opaco e cookie HttpOnly/Secure', async () => {
  const pool = customerPool();
  const customer = await authenticateCustomer(pool, {
    email: 'cliente@example.com',
    password: '123456',
    phone: '(47) 92000-6015',
    whatsappMarketingConsent: true,
    allowCreate: true,
  });
  const token = newCustomerSessionToken();
  await createCustomerSession(pool, customer.id, token);
  const req = { headers: { cookie: `vitta_customer_session=${token}` } };
  assert.equal(readCustomerSessionToken(req), token);
  assert.match(customerSessionCookie(token), /HttpOnly; Secure; SameSite=None/);
  const sessionCustomer = await getCustomerForSession(pool, token);
  assert.equal(sessionCustomer.id, customer.id);
  assert.equal(sessionCustomer.phone, '+5547920006015');
  assert.ok(sessionCustomer.whatsapp_marketing_consent_at);
});
