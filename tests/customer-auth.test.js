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
        const [id, email, display_name, password_salt, password_hash] = params;
        state.account = { id, email, display_name, password_salt, password_hash };
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
        } : null].filter(Boolean), []];
      }
      throw new Error(`Consulta inesperada: ${statement.slice(0, 50)}`);
    },
  };
}

test('cria conta com e-mail normalizado, aceita PIN de seis dígitos e nunca guarda a senha em texto aberto', async () => {
  const pool = customerPool();
  const created = await authenticateCustomer(pool, {
    email: '  Cliente@Example.com ',
    password: '123456',
    displayName: 'Cliente de Teste',
    allowCreate: true,
  });
  assert.equal(created.created, true);
  assert.equal(created.email, 'cliente@example.com');
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

test('não cria contas no login, exige senha correta e recusa senhas menores que seis caracteres', async () => {
  const pool = customerPool();
  await assert.rejects(
    authenticateCustomer(pool, { email: 'novo@example.com', password: '123456', allowCreate: false }),
    (error) => error instanceof CustomerAuthError && error.code === 'INVALID_CREDENTIALS',
  );
  await authenticateCustomer(pool, { email: 'cliente@example.com', password: '123456', allowCreate: true });
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
    allowCreate: true,
  });
  const token = newCustomerSessionToken();
  await createCustomerSession(pool, customer.id, token);
  const req = { headers: { cookie: `vitta_customer_session=${token}` } };
  assert.equal(readCustomerSessionToken(req), token);
  assert.match(customerSessionCookie(token), /HttpOnly; Secure; SameSite=None/);
  assert.deepEqual(await getCustomerForSession(pool, token), {
    id: customer.id,
    email: customer.email,
    display_name: customer.displayName,
  });
});
