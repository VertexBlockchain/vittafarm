const fs = require('node:fs/promises');
const path = require('node:path');
const { closePool, getPool } = require('../src/database');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function runMigrations() {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (migration_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );

    const files = (await fs.readdir(MIGRATIONS_DIR))
      .filter((file) => /^\d{3}_[a-z0-9_-]+\.sql$/.test(file))
      .sort();

    for (const file of files) {
      const [applied] = await connection.execute('SELECT migration_id FROM schema_migrations WHERE migration_id = ? LIMIT 1', [file]);
      if (applied.length) {
        process.stdout.write(`Já aplicada: ${file}\n`);
        continue;
      }

      const contents = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      const statements = contents.split(/;\s*(?=\n|$)/).map((statement) => statement.trim()).filter(Boolean);
      for (const statement of statements) await connection.query(statement);
      await connection.execute('INSERT INTO schema_migrations (migration_id) VALUES (?)', [file]);
      process.stdout.write(`Aplicada: ${file}\n`);
    }
  } finally {
    connection.release();
    await closePool();
  }
}

runMigrations().catch((error) => {
  const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN';
  console.error(`Falha ao aplicar as migrations do banco (${code}). Nenhum detalhe de credencial foi exibido.`);
  process.exitCode = 1;
});
