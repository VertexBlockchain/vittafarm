const { Pool } = require('pg');

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

  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.pathname || url.pathname === '/') {
    throw new Error('DATABASE_URL não contém as informações necessárias.');
  }

  const sslMode = url.searchParams.get('sslmode');
  if (sslMode && !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw new Error('A conexão PostgreSQL deve exigir TLS.');
  }

  return {
    connectionString: rawUrl,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false },
  };
}

function toPostgresSql(sql) {
  let index = 0;
  return sql
    .replace(/\?/g, () => `$${++index}`)
    .replace(/UTC_TIMESTAMP\(3\)/g, "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')")
    .replace(/DATE_ADD\(([^,]+), INTERVAL 8 HOUR\)/g, "$1 + INTERVAL '8 hours'");
}

function createCompatiblePool(options) {
  const nativePool = new Pool(options);
  return {
    async execute(sql, params = []) {
      const result = await nativePool.query(toPostgresSql(sql), params);
      return [result.rows, result.fields];
    },
    async query(sql, params = []) {
      return nativePool.query(sql, params);
    },
    async getConnection() {
      const client = await nativePool.connect();
      return {
        query: (sql, params = []) => client.query(sql, params),
        execute: (sql, params = []) => client.query(toPostgresSql(sql), params).then((result) => [result.rows, result.fields]),
        release: () => client.release(),
      };
    },
    end: () => nativePool.end(),
  };
}

function getPool() {
  if (!pool) pool = createCompatiblePool(parseDatabaseUrl(process.env.DATABASE_URL));
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

module.exports = { closePool, getPool, parseDatabaseUrl, pingDatabase, toPostgresSql };
