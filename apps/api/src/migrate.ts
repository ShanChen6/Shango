import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from './config';

async function main() {
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(9202601)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const directory = path.resolve(process.cwd(), 'migrations');
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [file])).rowCount)
        continue;
      await client.query('BEGIN');
      try {
        await client.query(await readFile(path.join(directory, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Applied ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(9202601)');
    client.release();
    await pool.end();
  }
}
void main().catch(() => {
  console.error('Migration failed. Check database availability and schema.');
  process.exitCode = 1;
});
