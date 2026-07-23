// Dev-only: give the seeded personas an email + password so the new sign-in
// screen is usable without hand-editing the database.
//
// Emails are derived from the persona's phone so they stay stable across
// re-seeds. The password is identical for every dev persona and is printed on
// completion — this script is for local fixtures and must never be pointed at
// a real database.

import { pool } from './db.mjs';
import { hashPassword } from './password.mjs';

const DEV_PASSWORD = 'eworks-dev-2026';

async function main() {
  if (process.env.EWORKS_ENV === 'production' || process.env.NODE_ENV === 'production') {
    throw new Error('refusing to seed shared dev passwords in production');
  }

  const { rows } = await pool.query(
    `select id, phone, full_name as "fullName" from eworks.user_profiles order by phone`);

  // One hash reused across fixtures: hashing 100+ rows separately at scrypt
  // cost takes minutes and buys nothing for throwaway local data.
  const hash = await hashPassword(DEV_PASSWORD);

  let updated = 0;
  for (const user of rows) {
    const local = (user.fullName || 'user')
      .toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
    const email = `${local}.${user.phone.slice(-4)}@eworks.test`;
    await pool.query(
      `update eworks.user_profiles set email = $2, password_hash = $3 where id = $1`,
      [user.id, email, hash]);
    updated += 1;
  }

  console.log(`seeded ${updated} accounts with password: ${DEV_PASSWORD}`);
  const sample = await pool.query(
    `select email from eworks.user_profiles where phone in ('9000000001','9000000002') order by phone`);
  for (const r of sample.rows) console.log('  e.g.', r.email);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
