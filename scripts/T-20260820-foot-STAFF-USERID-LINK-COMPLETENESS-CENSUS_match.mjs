import { q } from './dryrun_lib.mjs';
const JONGNO = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const r = async (label, sql) => { const rows = await q(sql); console.log(`\n== ${label} ==`); console.log(JSON.stringify(rows, null, 1)); return rows; };

// For each null-user_id staff: does an auth account exist matching by name?
// join user_profiles (up.id = auth uid) by trimmed name; also flag if that up.id already linked to another staff row.
await r('null-staff × auth match (by name via user_profiles)', `
  WITH nullstaff AS (
    SELECT id, name, role FROM staff
    WHERE clinic_id='${JONGNO}' AND active=true AND deleted_at IS NULL AND user_id IS NULL
  )
  SELECT ns.name AS staff_name, ns.role, ns.id AS staff_id,
         up.id AS auth_uid, up.email AS up_email, up.role AS up_role,
         up.clinic_id AS up_clinic, up.active AS up_active, up.approved AS up_approved,
         (SELECT count(*) FROM staff s2 WHERE s2.user_id = up.id) AS uid_already_linked_count
  FROM nullstaff ns
  LEFT JOIN user_profiles up ON btrim(up.name) = btrim(ns.name)
  ORDER BY ns.role, ns.name;`);

// auth.users direct: any auth account whose email localpart or metadata name matches? (name not in auth.users; check user_profiles is the linkage SSOT)
// count user_profiles for jongno to understand pool
await r('user_profiles jongno pool (active/approved)', `
  SELECT count(*) total,
         count(*) FILTER (WHERE active) active_cnt,
         count(*) FILTER (WHERE approved) approved_cnt
  FROM user_profiles WHERE clinic_id='${JONGNO}';`);

// orphan check: user_profiles jongno not linked to any staff row (potential accounts awaiting link)
await r('user_profiles jongno NOT linked to any staff (unlinked accounts)', `
  SELECT up.id, up.name, up.email, up.role, up.active, up.approved
  FROM user_profiles up
  WHERE up.clinic_id='${JONGNO}'
    AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.user_id = up.id)
  ORDER BY up.role, up.name;`);
