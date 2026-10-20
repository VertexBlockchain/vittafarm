const mysql = require('mysql2/promise');

let pool;

function parseDatabaseUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) {
    throw new Error('DATABASE_URL não está configurada.');
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('DATABASE_URL inválida.');
  }

  if (!['mysql:', 'mysql2:'].includes(url.protocol) || !url.hostname || !url.username || !url.pathname || url.pathname === '/') {
    throw new Error('DATABASE_URL não contém as informações necessárias.');
  }

  const encodedSsl = url.searchParams.get('ssl');
  if (!encodedSsl) throw new Error('A conexão MySQL deve exigir TLS.');

  let ssl;
  try {
    ssl = JSON.parse(encodedSsl);
  } catch {
    throw new Error('A configuração TLS da conexão MySQL é inválida.');
  }
  if (!ssl || typeof ssl !== 'object' || Array.isArray(ssl) || ssl.rejectUnauthorized === false) {
    throw new Error('A conexão MySQL exige validação de certificado TLS.');
  }

  let user;
  let password;
  let database;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error('DATABASE_URL contém codificação inválida.');
  }

  if (!user || !password || !database) throw new Error('DATABASE_URL não contém usuário, senha e banco.');

  return {
    host: url.hostname,
    port: Number(url.port) || 3306,
    user,
    password,
    database,
    ssl: { ...ssl, rejectUnauthorized: true },
    timezone: 'Z',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 10,
    connectTimeout: 10000,
  };
}

function getPool() {
  if (!pool) pool = mysql.createPool(parseDatabaseUrl(process.env.DATABASE_URL));
  return pool;
}

async function pingDatabase() {
  await getPool().query('SELECT 1');
}

async function closePool() {
  if (pool) {
    const activePool = pool;
    pool = undefined;
    await activePool.end();
  }
}

module.exports = { closePool, getPool, parseDatabaseUrl, pingDatabase };
