import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { loadEnv } from './load-env.mjs';

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  __dirname,
  '../../supabase/migrations/20260713000100_contracts_materials.sql',
);

const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('No SUPABASE_DB_URL / DATABASE_URL');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

const client = await pool.connect();
try {
  const pre = await client.query(
    `select to_regclass('eworks.contractors') as contractors,
            to_regclass('eworks.contracts') as contracts`,
  );
  console.log('before:', pre.rows[0]);

  if (pre.rows[0].contractors) {
    console.log('eworks.contractors already exists — nothing to apply.');
  } else {
    const sql = readFileSync(migrationPath, 'utf8');
    console.log('Applying', migrationPath);
    await client.query(sql);
    const post = await client.query(
      `select to_regclass('eworks.contractors') as contractors,
              to_regclass('eworks.contracts') as contracts`,
    );
    console.log('after:', post.rows[0]);
  }
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
