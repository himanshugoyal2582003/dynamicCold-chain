import * as dotenv from 'dotenv';
import { readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { Pool } from 'pg';

dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config({ path: resolve(__dirname, '../../../.env.local') });

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required to run migrations.');

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const migrationDir = join(__dirname, '../../db/migrations');
    const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort();
    for (const filename of files) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
      if (applied.rowCount) continue;
      const sql = await readFile(join(migrationDir, filename), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      console.log(`Applied migration ${filename}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Migration failed.');
  process.exit(1);
});
