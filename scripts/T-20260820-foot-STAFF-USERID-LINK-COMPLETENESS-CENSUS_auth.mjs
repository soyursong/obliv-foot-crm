import { q } from './dryrun_lib.mjs';
const r = async (label, sql) => { const rows = await q(sql); console.log(`\n== ${label} ==`); console.log(JSON.stringify(rows, null, 1)); return rows; };
await r('auth.users detail for matched uids', `
  SELECT id, email, email_confirmed_at IS NOT NULL AS email_confirmed,
         last_sign_in_at, created_at
  FROM auth.users
  WHERE id IN ('b6642918-98d8-4cd6-9099-f5d978442984',
               '63c387c0-eb89-4573-a47e-a7a128c27e94',
               '2ec0b57a-d81a-4739-ac13-f81254c056e1')
  ORDER BY email;`);
// which staff rows already consume the 김규리 uids
await r('staff rows linked to 김규리 uids', `
  SELECT id, name, role, active, user_id FROM staff
  WHERE user_id IN ('63c387c0-eb89-4573-a47e-a7a128c27e94','2ec0b57a-d81a-4739-ac13-f81254c056e1');`);
