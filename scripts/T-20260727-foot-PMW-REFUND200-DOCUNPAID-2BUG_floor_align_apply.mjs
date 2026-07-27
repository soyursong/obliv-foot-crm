/**
 * T-20260727-foot-PMW-REFUND200-DOCUNPAID-2BUG 요건(1) — resettle_insurance_grade 기징수(잠정 30%) 재구성 CEIL→FLOOR 정합.
 * DDL-ATOMIC v1.7 절차: PREFLIGHT → APPLY(단일 txn) → POSTCHECK(3항).
 *   change-class = ADDITIVE-LOGIC (CREATE OR REPLACE, 스키마/시그니처/컬럼/enum 무변경, body 1줄 CEIL→FLOOR).
 * 실행: node scripts/..._floor_align_apply.mjs          → PREFLIGHT 만 (dry, 미적용)
 *       node scripts/..._floor_align_apply.mjs --apply   → PREFLIGHT GO 시 APPLY + POSTCHECK
 */
import { readFileSync } from 'node:fs';

const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
const APPLY = process.argv.includes('--apply');
const UP_SQL_PATH = 'supabase/migrations/20260727213000_foot_resettle_provisional_floor_align.sql';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return t.trim() ? JSON.parse(t) : [];
}

const SIG = "resettle_insurance_grade(uuid, text, boolean, text)";

async function introspect() {
  const rows = await q(`
    SELECT p.oid,
           pg_get_function_identity_arguments(p.oid)  AS args,
           pg_get_function_result(p.oid)              AS result,
           p.prosecdef                                AS security_definer,
           p.proconfig                                AS config,
           p.prosrc                                   AS src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'resettle_insurance_grade'
      AND pg_get_function_identity_arguments(p.oid) = 'p_check_in_id uuid, p_confirmed_grade text, p_dry_run boolean, p_method text';
  `);
  return rows;
}

async function grants() {
  return q(`
    SELECT grantee, privilege_type
    FROM information_schema.role_routine_grants
    WHERE routine_schema='public' AND routine_name='resettle_insurance_grade'
    ORDER BY grantee, privilege_type;
  `);
}

// prosrc 안의 재구성 라인만 추출
function provLine(src) {
  const m = src.match(/v_prov_row\s*:=\s*LEAST\([^\n]*base_amount[^\n]*\)\s*;/);
  return m ? m[0].trim() : '(NOT FOUND)';
}
function hasCeil(src) { return /LEAST\(\s*CEIL\(\(?\s*v_calc\.base_amount\s*\*\s*0\.30/.test(src); }
function hasFloor(src) { return /LEAST\(\s*FLOOR\(\(?\s*v_calc\.base_amount\s*\*\s*0\.30/.test(src); }

// ── PREFLIGHT ──────────────────────────────────────────────────────────────
console.log('══════════ PREFLIGHT ══════════');
const pre = await introspect();
if (pre.length !== 1) {
  console.error(`ABORT: 함수 ${SIG} 실재 1건 아님 (found=${pre.length})`); process.exit(1);
}
const f = pre[0];
const preLine = provLine(f.src);
const preFloor = hasFloor(f.src);
const preCeil = hasCeil(f.src);
console.log('signature args  :', f.args);
console.log('result          :', f.result);
console.log('security_definer:', f.security_definer);
console.log('config          :', JSON.stringify(f.config));
console.log('재구성 라인     :', preLine);
console.log('CEIL 잔존       :', preCeil, ' / FLOOR 반영:', preFloor);

// grants
const gPre = await grants();
console.log('grants          :', JSON.stringify(gPre));

// schema_migrations ledger 확인 (base 존재 + 이번 버전 상태)
const ledger = await q(`
  SELECT version FROM supabase_migrations.schema_migrations
  WHERE version IN ('20260716220000','20260727213000') ORDER BY version;
`).catch(e => { console.log('ledger query note:', e.message); return []; });
const ledgerVers = ledger.map(r => r.version);
console.log('ledger(base/this):', JSON.stringify(ledgerVers));

// PREFLIGHT 판정
const sigOk = f.args === 'p_check_in_id uuid, p_confirmed_grade text, p_dry_run boolean, p_method text'
  && /jsonb/i.test(f.result) && f.security_definer === true
  && Array.isArray(f.config) && f.config.includes('search_path=public');
if (!sigOk) { console.error('ABORT PREFLIGHT: base 시그니처/속성 verbatim 불일치'); process.exit(1); }
const IDEMP = process.argv.includes('--allow-idempotent');
if (!preCeil && preFloor) {
  console.log('⚠ ANOMALY: prod 재구성 라인이 이미 FLOOR (CEIL 잔존 0) — 이미 적용됨(idempotent already-applied).');
  if (!IDEMP) {
    console.error('  → supervisor PREFLIGHT 는 CEIL 잔존 가정. 이미 FLOOR 이므로 hard-abort.');
    console.error('  → 재확인 후 idempotent 재-assert 하려면 --allow-idempotent 동반.');
    process.exit(3);
  }
  console.log('  → --allow-idempotent: 동일 body 재-assert(무해 no-op)로 verbatim 정합 확정 진행.');
} else if (!preCeil || preFloor) {
  console.error('ABORT PREFLIGHT: prod 재구성 라인이 CEIL 잔존도 FLOOR 도 아님 (예상외 변형). 수동 확인 요망.');
  process.exit(1);
} else {
  console.log('PREFLIGHT = GO (시그니처 verbatim + CEIL 잔존 + ledger 정합) — 정상 drift-fix 경로.');
}

if (!APPLY) {
  console.log('\n[DRY] --apply 없음 → APPLY 미실행. 위 PREFLIGHT 확인 후 --apply 로 실행.');
  process.exit(0);
}

// ── APPLY (단일 txn) ─────────────────────────────────────────────────────────
console.log('\n══════════ APPLY (BEGIN..COMMIT 단일 txn) ══════════');
const upSql = readFileSync(UP_SQL_PATH, 'utf8');
// up.sql 내장 txn-control 없음(검증필) → BEGIN/COMMIT 래핑 안전.
if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(upSql)) {
  console.error('ABORT: up.sql 내 txn-control 발견 — sentinel-bypass 위험, 수동 검토.'); process.exit(1);
}
const wrapped = `BEGIN;\n${upSql}\nCOMMIT;`;
await q(wrapped);
console.log('APPLY OK (HTTP 2xx, COMMIT)');

// ── POSTCHECK (3항) ──────────────────────────────────────────────────────────
console.log('\n══════════ POSTCHECK ══════════');
const post = await introspect();
if (post.length !== 1) { console.error('ABORT POSTCHECK: 함수 실재 1건 아님'); process.exit(1); }
const p = post[0];
const postLine = provLine(p.src);
const postFloor = hasFloor(p.src);
const postCeil = hasCeil(p.src);
// 명시 FLOOR 착지 형태 확인
const floorLanded = /FLOOR\(\(?\s*v_calc\.base_amount\s*\*\s*0\.30\s*\)?\s*\/\s*100\.0\)\s*\*\s*100/.test(p.src);
const gPost = await grants();
const revokedPublic = !gPost.some(r => r.grantee === 'PUBLIC');
const grantedAuth = gPost.some(r => r.grantee === 'authenticated' && r.privilege_type === 'EXECUTE');
const sigStable = p.args === 'p_check_in_id uuid, p_confirmed_grade text, p_dry_run boolean, p_method text'
  && /jsonb/i.test(p.result) && p.security_definer === true
  && Array.isArray(p.config) && p.config.includes('search_path=public');

console.log('(a) 재구성 라인 :', postLine);
console.log('    FLOOR 착지  :', floorLanded, ' / CEIL 소거:', !postCeil, ' / FLOOR 반영:', postFloor);
console.log('(b) 시그니처4인자+SECURITY DEFINER+search_path=public 불변 :', sigStable);
console.log('    args:', p.args, '| secdef:', p.security_definer, '| config:', JSON.stringify(p.config));
console.log('(c) REVOKE PUBLIC 유지:', revokedPublic, ' / GRANT EXECUTE authenticated 유지:', grantedAuth);
console.log('    grants:', JSON.stringify(gPost));

const passA = floorLanded && postFloor && !postCeil;
const passB = sigStable;
const passC = revokedPublic && grantedAuth;
const PASS = passA && passB && passC;
console.log(`\nPOSTCHECK = ${PASS ? 'PASS' : 'FAIL'}  (a=${passA} b=${passB} c=${passC})`);
if (!PASS) {
  console.error('\n⚠ POSTCHECK FAIL — rollback.sql(FLOOR→CEIL) 원복 필요. supervisor 회신 요망.');
  process.exit(2);
}
console.log('\n✅ 요건1 migration prod apply 완료 — CEIL→FLOOR 정합 착지.');
