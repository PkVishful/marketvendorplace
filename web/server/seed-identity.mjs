// Seed org tree + dev user phones only (no notifications/orders).
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.mjs';

const serverDir = dirname(fileURLToPath(import.meta.url));

async function main() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const file of ['seed-dev-identity.sql', 'seed-vendor-fixtures.sql']) {
      await client.query(readFileSync(join(serverDir, file), 'utf8'));
    }
    await client.query('commit');
    const { rows } = await pool.query(
      `select phone, full_name from eworks.user_profiles where phone like '900000000%' or phone like '910000000%' order by phone`,
    );
    console.log('Identity seed complete. Dev phones:');
    for (const r of rows) console.log(`  ${r.phone}  ${r.full_name}`);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error('Identity seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
