const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = 'vitta_customer_session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCRYPT_KEY_LENGTH = 64;

class CustomerAuthError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CustomerAuthError';
    this.code = code;
  }
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

function validatePassword(value) {
  return typeof value === 'string'
    && value.length >= PASSWORD_MIN_LENGTH
    && value.length <= PASSWORD_MAX_LENGTH;
}

async function passwordDigest(password, salt) {
  return scrypt(password, salt, SCRYPT_KEY_LENGTH, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

async function passwordMatches(password, saltHex, digestHex) {
  if (typeof saltHex !== 'string' || !/^[a-f0-9]{32}$/i.test(saltHex)
    || typeof digestHex !== 'string' || !/^[a-f0-9]{128}$/i.test(digestHex)) return false;
  const expected = Buffer.from(digestHex, 'hex');
  const actual = await passwordDigest(password, Buffer.from(saltHex, 'hex'));
  return crypto.timingSafeEqual(expected, actual);
}

async function findCustomerByEmail(pool, email) {
  const [rows] = await pool.execute(
    'SELECT id, email, display_name, password_salt, password_hash FROM customer_accounts WHERE email = ? LIMIT 1',
    [email],
  );
  return rows[0] || null;
}

async function authenticateCustomer(pool, { email: rawEmail, password, displayName = '', allowCreate = false }) {
  const email = normalizeEmail(rawEmail);
  if (!email || !validatePassword(password)) throw new CustomerAuthError('INVALID_CREDENTIALS');

  const existing = await findCustomerByEmail(pool, email);
  if (existing) {
    if (!await passwordMatches(password, existing.password_salt, existing.password_hash)) {
      throw new CustomerAuthError('INVALID_CREDENTIALS');
    }
    return { id: existing.id, email: existing.email, displayName: existing.display_name, created: false };
  }
  if (!allowCreate) throw new CustomerAuthError('INVALID_CREDENTIALS');

  const salt = crypto.randomBytes(16);
  const digest = await passwordDigest(password, salt);
  const id = crypto.randomUUID();
  const safeName = typeof displayName === 'string' ? displayName.trim().slice(0, 120) : '';
  try {
    await pool.execute(
      `INSERT INTO customer_accounts (id, email, display_name, password_salt, password_hash, account_consent_at)
       VALUES (?, ?, ?, ?, ?, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))`,
      [id, email, safeName, salt.toString('hex'), digest.toString('hex')],
    );
    return { id, email, displayName: safeName, created: true };
  } catch (error) {
    if (error?.code !== '23505' && error?.code !== 'ER_DUP_ENTRY') throw error;
    const racedCustomer = await findCustomerByEmail(pool, email);
    if (!racedCustomer || !await passwordMatches(password, racedCustomer.password_salt, racedCustomer.password_hash)) {
      throw new CustomerAuthError('INVALID_CREDENTIALS');
    }
    return { id: racedCustomer.id, email: racedCustomer.email, displayName: racedCustomer.display_name, created: false };
  }
}

function newCustomerSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(header = '') {
  const cookies = Object.create(null);
  for (const part of String(header).split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (name) cookies[name] = part.slice(separator + 1).trim();
  }
  return cookies;
}

function readCustomerSessionToken(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME] || '';
  return SESSION_TOKEN_PATTERN.test(token) ? token : '';
}

function customerSessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/api/customer; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=None`;
}

function expiredCustomerSessionCookie() {
  return `${COOKIE_NAME}=; Path=/api/customer; Max-Age=0; HttpOnly; Secure; SameSite=None`;
}

async function createCustomerSession(pool, customerId, token = newCustomerSessionToken()) {
  await pool.execute('DELETE FROM customer_sessions WHERE expires_at <= (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')');
  await pool.execute(
    "INSERT INTO customer_sessions (session_hash, customer_id, expires_at) VALUES (?, ?, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '30 days')",
    [hashSessionToken(token), customerId],
  );
  return token;
}

async function getCustomerForSession(pool, token) {
  if (!SESSION_TOKEN_PATTERN.test(token || '')) return null;
  const [rows] = await pool.execute(
    `SELECT customers.id, customers.email, customers.display_name
       FROM customer_sessions sessions
       JOIN customer_accounts customers ON customers.id = sessions.customer_id
      WHERE sessions.session_hash = ?
        AND sessions.expires_at > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      LIMIT 1`,
    [hashSessionToken(token)],
  );
  return rows[0] || null;
}

async function deleteCustomerSession(pool, token) {
  if (!SESSION_TOKEN_PATTERN.test(token || '')) return;
  await pool.execute('DELETE FROM customer_sessions WHERE session_hash = ?', [hashSessionToken(token)]);
}

module.exports = {
  COOKIE_NAME,
  CustomerAuthError,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  authenticateCustomer,
  createCustomerSession,
  customerSessionCookie,
  deleteCustomerSession,
  expiredCustomerSessionCookie,
  getCustomerForSession,
  newCustomerSessionToken,
  normalizeEmail,
  readCustomerSessionToken,
  validatePassword,
};
