/**
 * BEHAVIORAL ASSERTION HARNESS (db_only, HARD) — T-20260805-foot-USERPROFILES-CROSSROW-RLS-REMEDIATE
 *
 * e2e_spec_exempt_reason=db_only(RLS/guard 정책층) → 브라우저 E2E 무접점, 대신 behavioral
 * assertion(SQL)이 HARD 게이트. 본 harness 는 supervisor PHI DB-GATE 의 behavioral 5 assertion 을
 * ★무영속(all-rolled-back)★ 으로 사전 실증한다 — 각 assertion 은 자기 트랜잭션 안에서
 *   BEGIN → (마이그 DDL 적용) → SET LOCAL ROLE authenticated + jwt.sub → DML → 판정 → ROLLBACK.
 * prod 데이터/스키마 mutation 0. (실 apply 는 supervisor DB-GATE 통과 후.)
 *
 * remediation 구조:
 *   (a)  OOB `approved users update profiles` DROP → 비-admin cross-row UPDATE 차단.
 *   (b1) self_guard(BEFORE UPDATE, REJECT): own-row 6컬럼(role/approved/clinic_id/access_tier/active/exempt) 잠금.
 *   (b2) force_safe_insert(BEFORE INSERT, COERCE): 자가가입 elevated 컬럼 중화 — access_tier admin→member,
 *        role admin→staff, approved:=false, active coalesce, ★exempt_from_restrictions:=false(신규).
 *
 * 실행: (repo root) node scripts/T-20260805-foot-USERPROFILES-CROSSROW-RLS-REMEDIATE_behavioral.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN.
 */
import { q } from './dryrun_lib.mjs';

// ── 마이그 DDL 본문(post-remediation 상태 셋업; 함수 2개 CREATE OR REPLACE. 트리거는 prod 旣존재) ──
const MIG_DDL = `
DROP POLICY IF EXISTS "approved users update profiles" ON public.user_profiles;
CREATE OR REPLACE FUNCTION public.user_profiles_self_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $g$
BEGIN
  IF auth.uid() = NEW.id AND NOT is_admin_or_manager() THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN RAISE EXCEPTION 'role 변경 권한 없음'; END IF;
    IF COALESCE(NEW.approved,false) IS DISTINCT FROM COALESCE(OLD.approved,false) THEN RAISE EXCEPTION 'approved 변경 권한 없음'; END IF;
    IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id THEN RAISE EXCEPTION 'clinic_id 변경 권한 없음'; END IF;
    IF NEW.access_tier IS DISTINCT FROM OLD.access_tier THEN RAISE EXCEPTION 'access_tier 변경 권한 없음'; END IF;
    IF COALESCE(NEW.active,true) IS DISTINCT FROM COALESCE(OLD.active,true) THEN RAISE EXCEPTION 'active 변경 권한 없음'; END IF;
    IF NEW.exempt_from_restrictions IS DISTINCT FROM OLD.exempt_from_restrictions THEN RAISE EXCEPTION 'exempt_from_restrictions 변경 권한 없음'; END IF;
  END IF;
  RETURN NEW;
END; $g$;
CREATE OR REPLACE FUNCTION public.user_profiles_force_safe_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  NEW.approved := false;
  NEW.active := COALESCE(NEW.active, true);
  IF NEW.role IN ('admin') THEN NEW.role := 'staff'; END IF;
  IF NEW.access_tier IN ('admin') THEN NEW.access_tier := 'member'; END IF;
  NEW.exempt_from_restrictions := false;
  RETURN NEW;
END; $f$;
`;

// ── 실제 유저 id 선택(결정적): 승인 non-admin 1, admin 1, 별도 target 1 ──
async function pickUsers() {
  const nonAdmin = (await q(`SELECT id FROM public.user_profiles
      WHERE approved=true AND role NOT IN ('admin','manager','director')
        AND COALESCE(active,true)=true AND access_tier='member' AND exempt_from_restrictions=false
      ORDER BY id LIMIT 1;`))[0] ?? (await q(`SELECT id FROM public.user_profiles WHERE approved=true AND role NOT IN ('admin','manager','director') ORDER BY id LIMIT 1;`))[0];
  const admin = (await q(`SELECT id FROM public.user_profiles WHERE approved=true AND role='admin' ORDER BY id LIMIT 1;`))[0];
  const target = (await q(`SELECT id FROM public.user_profiles WHERE id NOT IN ('${nonAdmin.id}','${admin.id}') ORDER BY id LIMIT 1;`))[0];
  return { nonAdmin: nonAdmin.id, admin: admin.id, target: target.id };
}

const results = [];
function record(name, passed, detail) { results.push({ name, passed: passed === true, detail }); if (passed !== true) {/*noop*/} }

// ── UPDATE/cross-row 판정: DML 후 rowcount/raise 를 plpgsql 로 포착, 마지막 SELECT(passed) 반환 ──
function updateSql({ actorUid, dml, expect /* 'reject0'|'success1'|'raise' */ }) {
  return `
BEGIN;
${MIG_DDL}
DO $t$
DECLARE v_cnt int := -1; v_raised boolean := false; v_pass boolean;
BEGIN
  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"${actorUid}","role":"authenticated"}', true);
  BEGIN
    ${dml}
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  PERFORM set_config('role','postgres', true);
  v_pass := CASE '${expect}'
              WHEN 'reject0'  THEN (v_raised=false AND v_cnt=0)
              WHEN 'success1' THEN (v_raised=false AND v_cnt=1)
              WHEN 'raise'    THEN (v_raised=true)
            END;
  CREATE TEMP TABLE _r(passed boolean, detail text) ON COMMIT DROP;
  INSERT INTO _r VALUES (v_pass, format('expect=${expect} rows=%s raised=%s', v_cnt, v_raised));
END $t$;
SELECT passed, detail FROM _r;
ROLLBACK;`;
}
async function runU(name, spec) {
  try { const r = await q(updateSql(spec)); const row = (Array.isArray(r)?r:[])[0] ?? {};
        record(name, row.passed === true, row.detail); }
  catch (e) { record(name, false, 'HARNESS_ERROR: ' + String(e.message||e).slice(0,240)); }
}

// ── INSERT 코어싱 판정: 실 유저 프로필 선삭제(FK 충족) → 자가 INSERT(elevated 시도) → 코어싱된 값 실측 ──
//   passExpr = 삽입된 행이 safe(코어싱됨)이면 TRUE. INSERT 자체는 성공(coerce, not reject)해야 함.
function insertCoerceSql({ uid, insertCols, insertVals, passExpr, detailExpr }) {
  return `
BEGIN;
${MIG_DDL}
DELETE FROM public.user_profiles WHERE id = '${uid}';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"${uid}","role":"authenticated"}';
INSERT INTO public.user_profiles (${insertCols}) VALUES (${insertVals});
RESET ROLE;
SELECT (${passExpr}) AS passed, (${detailExpr}) AS detail
  FROM public.user_profiles WHERE id = '${uid}';
ROLLBACK;`;
}
async function runI(name, spec) {
  try { const r = await q(insertCoerceSql(spec)); const row = (Array.isArray(r)?r:[])[0] ?? {};
        record(name, row.passed === true, row.detail); }
  catch (e) { record(name, false, 'INSERT raised/err(코어싱 실패): ' + String(e.message||e).slice(0,200)); }
}

const U = await pickUsers();
console.log('actors:', JSON.stringify(U));

// ══ supervisor behavioral 5 assertion (STAGE-2 §PHI DB-GATE) ══
// 1. 승인 non-admin cross-row UPDATE → REJECTED(RLS 0-row = 벡터B 봉합)  [dispositive]
await runU('A1 non-admin cross-row UPDATE → REJECTED(0 rows)', {
  actorUid: U.nonAdmin, dml: `UPDATE public.user_profiles SET name=name WHERE id='${U.target}';`, expect: 'reject0' });
// 2. 승인 직원 self-row UPDATE(정당 name 편집) → SUCCESS(회귀 0)
await runU('A2 non-admin self-row UPDATE(name) → SUCCESS(1 row)', {
  actorUid: U.nonAdmin, dml: `UPDATE public.user_profiles SET name=COALESCE(name,'') WHERE id='${U.nonAdmin}';`, expect: 'success1' });
// 3. own-row role 승격 → RAISE(guard intact)
await runU('A3 own-row role 승격(→admin) → RAISE(guard)', {
  actorUid: U.nonAdmin, dml: `UPDATE public.user_profiles SET role='admin' WHERE id='${U.nonAdmin}';`, expect: 'raise' });
// 4a/b/c. own-row access_tier/exempt/active 승격 → RAISE((b1) 3컬럼)
await runU('A4a own-row access_tier 승격 → RAISE((b1))', {
  actorUid: U.nonAdmin, dml: `UPDATE public.user_profiles SET access_tier='admin' WHERE id='${U.nonAdmin}';`, expect: 'raise' });
await runU('A4b own-row exempt_from_restrictions 승격(→true) → RAISE((b1))', {
  actorUid: U.nonAdmin, dml: `UPDATE public.user_profiles SET exempt_from_restrictions=true WHERE id='${U.nonAdmin}';`, expect: 'raise' });
await runU('A4c own-row active 변경(→false) → RAISE((b1))', {
  actorUid: U.nonAdmin, dml: `UPDATE public.user_profiles SET active=false WHERE id='${U.nonAdmin}';`, expect: 'raise' });
// 5. admin cross-row UPDATE(계정관리) → SUCCESS(legit 유지)
await runU('A5 admin cross-row UPDATE → SUCCESS(1 row, legit)', {
  actorUid: U.admin, dml: `UPDATE public.user_profiles SET name=COALESCE(name,'') WHERE id='${U.target}';`, expect: 'success1' });

// ══ (b2) INSERT 병렬 가드 실증 — 자가가입 elevated 주입이 coerce(중화)되는지 ══
// A6 self-INSERT exempt=true → 삽입 성공 & 결과 exempt=false (신규 코어싱 = 봉합)
await runI('A6 self-INSERT exempt=true → COERCED exempt=false', {
  uid: U.nonAdmin,
  insertCols: 'id,email,name,exempt_from_restrictions',
  insertVals: `'${U.nonAdmin}','beh@example.invalid','beh',true`,
  passExpr: `exempt_from_restrictions = false`,
  detailExpr: `format('exempt=%s (기대 false)', exempt_from_restrictions)` });
// A7 self-INSERT access_tier=admin → 삽입 성공 & 결과 access_tier=member (旣존 코어싱 유지)
await runI('A7 self-INSERT access_tier=admin → COERCED access_tier=member', {
  uid: U.nonAdmin,
  insertCols: 'id,email,name,access_tier',
  insertVals: `'${U.nonAdmin}','beh@example.invalid','beh','admin'`,
  passExpr: `access_tier = 'member'`,
  detailExpr: `format('access_tier=%s (기대 member)', access_tier)` });
// A8 self-INSERT role=admin+approved=true+exempt=true 복합 → 전부 coerce(role=staff, approved=false, exempt=false)
await runI('A8 self-INSERT 복합 elevated → COERCED(role=staff/approved=false/exempt=false)', {
  uid: U.nonAdmin,
  insertCols: 'id,email,name,role,approved,exempt_from_restrictions',
  insertVals: `'${U.nonAdmin}','beh@example.invalid','beh','admin',true,true`,
  passExpr: `role='staff' AND approved=false AND exempt_from_restrictions=false`,
  detailExpr: `format('role=%s approved=%s exempt=%s (기대 staff/false/false)', role, approved, exempt_from_restrictions)` });

console.log('\n===== BEHAVIORAL ASSERTION RESULTS =====');
let allPass = true;
for (const r of results) { if (!r.passed) allPass = false;
  console.log(`  [${r.passed ? 'PASS' : 'FAIL'}] ${r.name}  —  ${r.detail}`); }
console.log(`\n${allPass ? '== ALL BEHAVIORAL ASSERTIONS PASS ==' : '== BEHAVIORAL FAIL =='} (무영속·all rolled back)`);
process.exit(allPass ? 0 : 1);
