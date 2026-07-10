/**
 * T-20260702-foot-CODY-PKG-CREATE-PERM — 계정 삭제 READ-ONLY 진단
 * ⚠ 목표 반전: 기존 enable/open(_diag.mjs) 폐기 → 계정 영구 삭제 준비.
 *
 * 대상: 김연희 / kyh3858@hanmail.net / id d4c83d20-e8d6-4918-97ce-2cce68d444ae
 * 이 스크립트는 SELECT-only. DELETE/UPDATE/DDL 0. DA CONSULT + supervisor DB-gate용 evidence.
 *
 * SOP 준수:
 *  - GOTRUE-ADMIN-EMAIL-FILTER-BAN (T-20260705-ops) INV-1~4:
 *      auth.users 권위 DB조회(id) + email 역방향 정확일치(=1건 & =TARGET_ID) + GoTrue getUserById 재조회 assert
 *  - Orphan-Row Archive-First & FK Integrity Guard:
 *      pg_constraint 로 auth.users(id)·user_profiles(id) 참조 FK 전수 열거 → 자식행 count
 */
import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL = env.VITE_SUPABASE_URL;
const SRK = env.SUPABASE_SERVICE_ROLE_KEY;
const ACCESS = env.SUPABASE_ACCESS_TOKEN;
const REF = URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)[1];

const TARGET_ID = 'd4c83d20-e8d6-4918-97ce-2cce68d444ae';
const TARGET_EMAIL = 'kyh3858@hanmail.net';

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`SQL → ${r.status} ${await r.text()}`);
  return r.json();
}

let ABORT = false;
const q = (s) => `'${s.replace(/'/g, "''")}'`;

console.log('════════════════════════════════════════════════════════════');
console.log('T-20260702 계정 삭제 — READ-ONLY 진단 (project', REF + ')');
console.log('target id   :', TARGET_ID);
console.log('target email:', TARGET_EMAIL);
console.log('════════════════════════════════════════════════════════════');

// ── 1. auth.users 권위 DB조회 by id (INV-1: 서버필터 아닌 DB 권위) ──
console.log('\n=== 1. auth.users WHERE id (DB 권위 조회) ===');
const byId = await sql(`SELECT id, email, created_at, last_sign_in_at, email_confirmed_at, banned_until, deleted_at
  FROM auth.users WHERE id = ${q(TARGET_ID)};`);
console.log('  행수:', byId.length);
byId.forEach(u => console.log('  ', JSON.stringify(u)));
if (byId.length !== 1) { console.log('  ❌ id로 1행 아님 → ABORT'); ABORT = true; }
else if ((byId[0].email || '').trim().toLowerCase() !== TARGET_EMAIL.toLowerCase()) {
  console.log('  ❌ id의 email이 기대값과 불일치 → ABORT'); ABORT = true;
} else console.log('  ✅ id→email 일치');

// ── 2. auth.users email 역방향 정확일치 (INV-2/3) ──
console.log('\n=== 2. auth.users WHERE lower(email)=lower(target) (역방향, INV-2/3) ===');
const byEmail = await sql(`SELECT id, email FROM auth.users WHERE lower(trim(email)) = lower(trim(${q(TARGET_EMAIL)}));`);
console.log('  정확일치 행수:', byEmail.length, '(0건→not-found / ≥2건→모호성 hard error)');
byEmail.forEach(u => console.log('  ', JSON.stringify(u)));
if (byEmail.length !== 1) { console.log('  ❌ 정확일치 ≠ 1건 → ABORT'); ABORT = true; }
else if (byEmail[0].id !== TARGET_ID) { console.log('  ❌ email→id 불일치 → ABORT'); ABORT = true; }
else console.log('  ✅ email→id 역방향 일치');

// ── 3. GoTrue admin getUserById 재조회 (INV-4 API-레벨 assert) ──
console.log('\n=== 3. GoTrue admin getUserById(id) 재조회 (INV-4) ===');
try {
  const r = await fetch(`${URL}/auth/v1/admin/users/${TARGET_ID}`, {
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}` },
  });
  if (!r.ok) { console.log('  getUserById HTTP', r.status, await r.text()); }
  else {
    const u = await r.json();
    console.log('  id=', u.id, 'email=', u.email);
    const ok = u.id === TARGET_ID && (u.email || '').trim().toLowerCase() === TARGET_EMAIL.toLowerCase();
    console.log('  INV-4 assert:', ok ? '✅ PASS' : '❌ FAIL → ABORT');
    if (!ok) ABORT = true;
  }
} catch (e) { console.log('  getUserById 예외:', e.message); }

// ── 4. app 테이블 (user_profiles / staff) 존재 대조 ──
console.log('\n=== 4. app 테이블 대조 ===');
async function tableExists(t) {
  const r = await sql(`SELECT to_regclass('public.${t}') AS reg;`);
  return r[0]?.reg != null;
}
for (const t of ['user_profiles', 'staff']) {
  if (!(await tableExists(t))) { console.log(`  public.${t}: (테이블 없음)`); continue; }
  const cols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${q(t)};`);
  const colNames = cols.map(c => c.column_name);
  const idCols = ['id', 'user_id'].filter(c => colNames.includes(c));
  for (const c of idCols) {
    const rows = await sql(`SELECT * FROM public.${t} WHERE ${c} = ${q(TARGET_ID)};`);
    console.log(`  ${t}.${c}: ${rows.length}행`);
    rows.forEach(r => console.log('    ', JSON.stringify(r)));
  }
}

// ── 5. FK 참조 전수 열거: auth.users(id) 와 user_profiles(id) 를 가리키는 모든 FK ──
console.log('\n=== 5. FK 참조 전수 (pg_constraint) — 부모=auth.users / user_profiles ===');
const fks = await sql(`
  SELECT
    con.conname,
    src_ns.nspname || '.' || src.relname AS child_table,
    att.attname AS child_col,
    tgt_ns.nspname || '.' || tgt.relname AS parent_table,
    tatt.attname AS parent_col,
    con.confdeltype AS on_delete
  FROM pg_constraint con
  JOIN pg_class src  ON src.oid = con.conrelid
  JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
  JOIN pg_class tgt  ON tgt.oid = con.confrelid
  JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
  JOIN unnest(con.conkey)  WITH ORDINALITY AS ck(attnum, ord) ON true
  JOIN unnest(con.confkey) WITH ORDINALITY AS cfk(attnum, ord) ON cfk.ord = ck.ord
  JOIN pg_attribute att  ON att.attrelid = con.conrelid  AND att.attnum = ck.attnum
  JOIN pg_attribute tatt ON tatt.attrelid = con.confrelid AND tatt.attnum = cfk.attnum
  WHERE con.contype = 'f'
    AND ( (tgt_ns.nspname='auth' AND tgt.relname='users')
       OR (tgt_ns.nspname='public' AND tgt.relname='user_profiles') )
  ORDER BY parent_table, child_table, child_col;`);
console.log('  FK 개수:', fks.length, '(confdeltype: a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL, d=SET DEFAULT)');
const childRefs = [];
for (const f of fks) {
  console.log(`  FK ${f.conname}: ${f.child_table}.${f.child_col} → ${f.parent_table}.${f.parent_col} [on_delete=${f.on_delete}]`);
  childRefs.push(f);
}

// ── 6. 각 child FK 컬럼에서 TARGET_ID 참조 자식행 count ──
console.log('\n=== 6. 자식행 count (각 FK 컬럼별) ===');
let totalChildRows = 0;
const childHits = [];
for (const f of childRefs) {
  const [schema, tbl] = f.child_table.split('.');
  try {
    const c = await sql(`SELECT count(*)::int AS n FROM ${schema}."${tbl}" WHERE "${f.child_col}" = ${q(TARGET_ID)};`);
    const n = c[0]?.n ?? 0;
    if (n > 0) { childHits.push({ table: f.child_table, col: f.child_col, on_delete: f.on_delete, n }); totalChildRows += n; }
    console.log(`  ${f.child_table}.${f.child_col} = ${n}행 ${n > 0 ? '⚠' : ''}`);
  } catch (e) { console.log(`  ${f.child_table}.${f.child_col} 조회오류: ${e.message.slice(0, 120)}`); }
}
console.log('  자식행 총합:', totalChildRows);

// ── 7. 논리적(비-FK) 참조 스캔: created_by 류 컬럼이 FK 없이 id를 담을 수 있음 ──
console.log('\n=== 7. 논리 참조 스캔 (FK 없는 uuid 컬럼에 id 저장 가능성) ===');
const suspectCols = await sql(`
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema='public' AND data_type='uuid'
    AND column_name IN ('created_by','updated_by','user_id','staff_id','assigned_to',
      'counselor_id','therapist_id','doctor_id','author_id','owner_id','performed_by',
      'checked_in_by','actor_id','modified_by','registered_by','approved_by')
  ORDER BY table_name, column_name;`);
let logicalHits = [];
for (const s of suspectCols) {
  try {
    const c = await sql(`SELECT count(*)::int AS n FROM public."${s.table_name}" WHERE "${s.column_name}" = ${q(TARGET_ID)};`);
    const n = c[0]?.n ?? 0;
    if (n > 0) { logicalHits.push({ table: 'public.' + s.table_name, col: s.column_name, n }); console.log(`  ⚠ public.${s.table_name}.${s.column_name} = ${n}행`); }
  } catch (e) { /* skip */ }
}
if (logicalHits.length === 0) console.log('  ✅ 논리 참조 uuid 컬럼에서 이 id 참조 0행');

// ── 8. freeze-set baseline ──
console.log('\n=== 8. freeze-set baseline (삭제 후 diff=1 검증용) ===');
const upBase = await sql(`SELECT count(*)::int AS n FROM public.user_profiles;`).catch(() => [{ n: null }]);
const authBase = await sql(`SELECT count(*)::int AS n FROM auth.users;`);
console.log('  user_profiles 총계:', upBase[0].n);
console.log('  auth.users 총계:', authBase[0].n);

// ── 요약 ──
console.log('\n════════════════════════════════════════════════════════════');
console.log('진단 요약');
console.log('  id↔email 재검증(INV-1~4):', ABORT ? '❌ ABORT' : '✅ PASS');
console.log('  FK 참조 정의 개수:', childRefs.length);
console.log('  자식행 hits(FK):', JSON.stringify(childHits));
console.log('  논리 참조 hits:', JSON.stringify(logicalHits));
console.log('  baseline user_profiles:', upBase[0].n, '/ auth.users:', authBase[0].n);
console.log('════════════════════════════════════════════════════════════');
if (ABORT) { console.log('\n⛔ ABORT — planner 즉시 보고. destructive 진행 금지.'); process.exit(2); }
console.log('\n✅ READ-ONLY 진단 완료. 다음 게이트: (1) DA CONSULT (2) supervisor DB-gate → 그 후 archive+DELETE.');
