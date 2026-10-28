import { Pool } from 'pg';
import { loadConfig } from './config';
import { phoneSchema } from './validation';

async function main() {
  const phone = phoneSchema.parse(process.argv[2]);
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE users SET role='admin' WHERE phone=$1 AND role='customer' AND status='active' RETURNING id`,
      [phone],
    );
    if (result.rowCount !== 1)
      throw new Error(
        'First sign in as a customer; only active customer accounts can be promoted.',
      );
    await client.query(
      `INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
      VALUES($1, 'admin.bootstrap', 'user', $1, '{"source":"operator-cli"}')`,
      [result.rows[0].id],
    );
    await client.query('COMMIT');
    console.log('Administrator granted. Sign in again to refresh your profile.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
void main().catch(() => {
  console.error('Grant failed. Check account and configuration.');
  process.exitCode = 1;
});
