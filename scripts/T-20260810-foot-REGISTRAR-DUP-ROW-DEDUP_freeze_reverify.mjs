/**
 * FREEZE RE-VERIFY (READ-ONLY) — T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP
 *
 *   목적: supervisor DB-GATE dry-run 직전 freeze셋 재검증 + PK-precise rollback 근거 확보.
 *   census(c8ca1f6a) 이후 prod drift 검출 + re-point 대상 staff_attendance PK 실측
 *   (rollback 을 blanket 이 아닌 PK 한정으로 만들기 위함).
 *
 *   ⚠ 전부 SELECT introspection. WRITE 0 · DDL 0 · DML 0 (assertReadOnly 강제).
 *   실행: node scripts/T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP_freeze_reverify.mjs
 */
import { q } from './dryrun_lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

function assertReadOnly(sql) {
  const forbidden = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge)\b/i;
  const stripped = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (forbidden.test(stripped)) throw new Error(`READ-ONLY 위반 감지: ${sql.slice(0, 80)}`);
}

const SURV = {
  '강다연': '0ff81a68-9696-4a3a-b7ce-38973e37ee36',
  '이진석': '884b4571-fbfb-4aa7-871c-f555dc296956',
};
const LOSER = {
  '강다연': '4bcf55a2-4472-48ac-86a1-fca4b576ac21',
  '이진석': '9a429fb7-699b-4647-94da-c2ec1e61b3c9',
};
const ALL = [...Object.values(SURV), ...Object.values(LOSER)];
const IDLIST = ALL.map((s) => `'${s}'`).join(',');
const LOSER_LIST = Object.values(LOSER).map((s) => `'${s}'`).join(',');

async function run(sql) {
  assertReadOnly(sql);
  return q(sql);
}

const out = {};

// R1: 4 staff 레코드 identity 축 재실측 (survivor active·loser active·user_id)
out.R1_staff_axes = await run(`
  SELECT s.id, s.name, s.role, s.active, s.clinic_id, s.user_id, s.created_at,
         u.email AS auth_email, u.last_sign_in_at, u.email_confirmed_at
  FROM public.staff s
  LEFT JOIN auth.users u ON u.id = s.user_id
  WHERE s.id IN (${IDLIST})
  ORDER BY s.name, s.created_at`);

// R2: re-point 대상 staff_attendance PK 실측 (rollback PK-freeze 근거) — row_to_json 로 스키마 무관
out.R2_attendance_pks = await run(`
  SELECT id AS attendance_id, staff_id, row_to_json(sa.*) AS full_row
  FROM public.staff_attendance sa
  WHERE staff_id IN (${LOSER_LIST})
  ORDER BY staff_id, id`);

// R3: full-FK 기계열거 — confrelid=staff 인 모든 inbound FK (손열거 금지)
out.R3_inbound_fks = await run(`
  SELECT con.conname, ns.nspname AS child_schema, cl.relname AS child_table,
         att.attname AS child_col, con.confdeltype
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = cl.relnamespace
  JOIN pg_class rcl ON rcl.oid = con.confrelid
  JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
  WHERE con.contype = 'f' AND rcl.relname = 'staff' AND rcl.relnamespace = 'public'::regnamespace
  ORDER BY child_schema, child_table, child_col`);

// R4: loser 잔여 참조 전수 sweep — R3 로 얻은 모든 (schema.table.col) 에서 loser 참조 계수
const fkRows = out.R3_inbound_fks;
const perFk = [];
for (const fk of fkRows) {
  const tbl = `${fk.child_schema}.${fk.child_table}`;
  const col = fk.child_col;
  const sql = `SELECT '${tbl}' AS tbl, '${col}' AS col, count(*)::int AS loser_refs
               FROM ${tbl} WHERE ${col} IN (${LOSER_LIST})`;
  try {
    const r = await run(sql);
    if (r[0] && r[0].loser_refs > 0) perFk.push(r[0]);
  } catch (e) {
    perFk.push({ tbl, col, error: String(e).slice(0, 120) });
  }
}
out.R4_loser_refs_nonzero = perFk;

// R5: 8쌍 carve 불변 재확인 (cross-clinic seed 16행 — 정리대상 아님)
out.R5_carve_8pairs = await run(`
  SELECT name, count(*)::int AS rows, count(DISTINCT clinic_id)::int AS clinics,
         count(*) FILTER (WHERE staff_id IS NULL)::int AS null_staff_id
  FROM public.reservation_registrars
  WHERE name IN ('김민경','김지혜','박민석','장예지','김효신','문해민','이수빈','진운선')
  GROUP BY name ORDER BY name`);

mkdirSync('db-gate', { recursive: true });
writeFileSync(
  'db-gate/T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP_freeze_reverify.json',
  JSON.stringify({ mode: 'READ-ONLY', ref: process.env.FOOT_SUPABASE_REF || 'rxlomoozakkjesdqjtvd', at: 'run-time', ...out }, null, 2),
);

console.log('=== R1 staff identity 축 ===');
for (const r of out.R1_staff_axes) {
  const isSurv = Object.values(SURV).includes(r.id);
  console.log(`  ${r.name} ${r.id.slice(0, 8)} [${isSurv ? 'SURVIVOR' : 'loser'}] active=${r.active} user_id=${r.user_id ? r.user_id.slice(0, 8) : 'NULL'} email=${r.auth_email || '-'} last_sign_in=${r.last_sign_in_at || '-'}`);
}
console.log('\n=== R2 re-point 대상 staff_attendance PK ===');
for (const r of out.R2_attendance_pks) console.log(`  attendance ${r.attendance_id} staff=${r.staff_id.slice(0, 8)}`);
console.log(`  총 ${out.R2_attendance_pks.length}행`);
console.log('\n=== R3 inbound FK 총계 ===', fkRows.length);
console.log('=== R4 loser 참조 nonzero ===');
console.log(JSON.stringify(perFk, null, 2));
console.log('\n=== R5 8쌍 carve ===');
for (const r of out.R5_carve_8pairs) console.log(`  ${r.name}: rows=${r.rows} clinics=${r.clinics} null_staff_id=${r.null_staff_id}`);
console.log('\n✅ freeze_reverify 완료 (WRITE 0 / DDL 0 / DML 0). evidence → db-gate/..._freeze_reverify.json');
