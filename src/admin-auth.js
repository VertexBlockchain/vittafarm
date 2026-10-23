const crypto = require('node:crypto');

const COOKIE_NAME = 'vitta_admin_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const PASSWORD_MIN_LENGTH = 16;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function passwordConfigured(password) {
  return typeof password === 'string' && password.length >= PASSWORD_MIN_LENGTH;
}

function passwordMatches(expected, provided) {
  if (!passwordConfigured(expected) || typeof provided !== 'string' || provided.length > 256) return false;
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  const providedDigest = crypto.createHash('sha256').update(provided, 'utf8').digest();
  return crypto.timingSafeEqual(expectedDigest, providedDigest);
}

function parseCookies(header = '') {
  const result = Object.create(null);
  for (const part of String(header).split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) result[name] = value;
  }
  return result;
}

function readSessionToken(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME] || '';
  return SESSION_TOKEN_PATTERN.test(token) ? token : '';
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/api/admin; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=None`;
}

function expiredSessionCookie() {
  return `${COOKIE_NAME}=; Path=/api/admin; Max-Age=0; HttpOnly; Secure; SameSite=None`;
}

async function createSession(pool, token) {
  await pool.execute('DELETE FROM admin_sessions WHERE expires_at <= (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')');
  await pool.execute(
    "INSERT INTO admin_sessions (session_hash, expires_at) VALUES (?, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '8 hours')",
    [hashToken(token)],
  );
}

async function isSessionValid(pool, token) {
  if (!SESSION_TOKEN_PATTERN.test(token || '')) return false;
  const [rows] = await pool.execute(
    "SELECT 1 FROM admin_sessions WHERE session_hash = ? AND expires_at > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') LIMIT 1",
    [hashToken(token)],
  );
  return rows.length === 1;
}

async function deleteSession(pool, token) {
  if (!SESSION_TOKEN_PATTERN.test(token || '')) return;
  await pool.execute('DELETE FROM admin_sessions WHERE session_hash = ?', [hashToken(token)]);
}

module.exports = {
  COOKIE_NAME,
  PASSWORD_MIN_LENGTH,
  SESSION_TTL_SECONDS,
  createSession,
  deleteSession,
  expiredSessionCookie,
  isSessionValid,
  newSessionToken,
  passwordConfigured,
  passwordMatches,
  readSessionToken,
  sessionCookie,
};
