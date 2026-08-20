/**
 * CENSUS (READ-ONLY): T-20260820-foot-STAFF-USERID-LINK-COMPLETENESS-CENSUS
 * jongno-foot active staff 中 user_id IS NULL 전수 + auth 계정 실존 대조 + (A)/(B) 분류.
 * db_change=FALSE. SELECT introspection only. WRITE 0 / DDL 0.
 */
import { q } from './dryrun_lib.mjs';
const JONGNO = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const r = async (label, sql) => { const rows = await q(sql); console.log(`\n== ${label} ==`); console.log(JSON.stringify(rows, null, 1)); return rows; };

// user_profiles schema (linkage model)
await r('user_profiles columns', `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='user_profiles' ORDER BY ordinal_position;`);

// active staff role distribution jongno-foot (linked vs null)
await r('jongno active staff by role: linked vs null', `
  SELECT role,
         count(*) AS total_active,
         count(*) FILTER (WHERE user_id IS NULL) AS user_id_null,
         count(*) FILTER (WHERE user_id IS NOT NULL) AS user_id_set
  FROM staff
  WHERE clinic_id='${JONGNO}' AND active=true AND deleted_at IS NULL
  GROUP BY role ORDER BY role;`);

// FULL LIST: jongno active staff with user_id IS NULL
await r('jongno active staff user_id IS NULL (full list)', `
  SELECT id, name, role, phone, created_at
  FROM staff
  WHERE clinic_id='${JONGNO}' AND active=true AND deleted_at IS NULL AND user_id IS NULL
  ORDER BY role, name;`);
