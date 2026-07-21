import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// A single shared connection pool for the whole process. Every route file
// imports this rather than opening its own connections.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  // Catches errors on idle clients (e.g. DB restarted) so the whole
  // process doesn't crash on a transient connection blip.
  console.error('Unexpected error on idle Postgres client', err);
});

/**
 * Small helper so route files can do `await query('SELECT ...', [params])`
 * instead of checking out/releasing a client manually for simple cases.
 */
export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  if (process.env.NODE_ENV === 'development') {
    console.log('query', { text, duration: Date.now() - start, rows: res.rowCount });
  }
  return res;
}

/**
 * For multi-statement operations that must succeed or fail together
 * (e.g. "insert transaction row" + "insert ledger row" inside /loyalty/claim).
 * Usage:
 *   await withTransaction(async (client) => {
 *     await client.query(...);
 *     await client.query(...);
 *   });
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
