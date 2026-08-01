/**
 * T-20260725-foot-DESIGNPT-THERAPIST-ROLE-WRITEBLOCK — prod apply + 침투테스트 evidence runner
 *
 * supervisor DB-GATE-REPLY GO: MSG-20260802-074725-cbc5
 *   (SQL 정적리뷰 PASS + DEV dry-run PASS + §8 2.8 DA HOLD clear + prod apply 승인).
 *
 * 집행:
 *   0) prod introspection (read-only) — current_user_role() 실재 + designated_therapist_id uuid(FK→staff.id) + trigger pre=0.
 *   1) apply supabase/migrations/20260802120000_customers_designated_therapist_writeguard.sql (foot prod ref rxlomoozakkjesdqjtvd)
 *      - ADDITIVE(신규 함수+트리거만). 원장 forward-doc(foot manual-apply 관례) → recordLedger.
 *   2) 침투테스트 ①~⑤ — 전부 무영속(각 DO 블록이 끝에서 RAISE EXCEPTION 으로 자기 트랜잭션을 abort → prod 무변경).
 *      역할 시뮬레이션 = set_config('request.jwt.claims', {sub:<role별 실존 user_profile id>}) →
 *        current_user_role() 가 user_profiles.role 을 실제 해석 → 트리거 결정입력(v_role)을 실경로로 재현.
 *      designated 값 = 실존 staff.id(FK 충족), 대상 고객의 현재값과 다른 값으로 강제(①②는 실제 IS DISTINCT 발화).
 *      판정은 반환 메시지로 확정: 성공→'EVIDENCE|OK|rows=N' / 트리거거부→SQLSTATE 42501(+Korean).
 *      ① therapist  → designated UPDATE(값변경) → 42501 거부(row 미반영)
 *      ② admin·manager·consultant·coordinator → 동일 UPDATE → 성공(rows=1)
 *      ③ therapist  → phone UPDATE(designated 미포함) → 성공(트리거 미발화, rows=1)
 *      ④ therapist  → designated 동일값 UPDATE → 성공(no-op, IS DISTINCT FROM=false, rows=1)
 *      ⑤ service_role(jwt.claims 미설정=auth.uid() NULL) → designated UPDATE → 성공(무저촉, rows=1)
 *
 * PHI 위생: 고객 name/phone 값 미출력. user/customer/staff uuid 는 마지막 4자만 표기.
 *
 * usage: node scripts/T-20260725-...apply.mjs           (DRY — introspection + 계획만)
 *        node scripts/T-20260725-...apply.mjs --apply    (apply + 침투테스트 evidence)
 * author: dev-foot / 2026-08-02
 */
import { query, recordLedger, PROJ_REF, MIG_DIR } from './lib/foot_migration_ledger.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const kst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
const VERSION = '20260802120000';
const MIG_FILE = '20260802120000_customers_designated_therapist_writeguard.sql';
const TRG = 'trg_designated_therapist_writeguard';
const FN = 'fn_designated_therapist_writeguard';
const mask = (s) => (s ? '…' + String(s).slice(-4) : String(s));
const scalar = async (sql) => { const r = await query(sql); const row = (Array.isArray(r) ? r : [])[0] || {}; return row[Object.keys(row)[0]]; };

console.log('════════════════════════════════════════════════════════════');
console.log(`[${APPLY ? 'APPLY(실적용)' : 'DRY(introspection+계획)'}] DESIGNPT WRITEBLOCK — ref ${PROJ_REF} (${kst()})`);
console.log('════════════════════════════════════════════════════════════\n');

// ── 0. introspection (read-only) ──
const hasRoleFn = await scalar(`SELECT count(*)::int FROM pg_proc WHERE proname='current_user_role';`);
console.log(`[introspect] current_user_role() present = ${hasRoleFn} (기대 1, 의존)`);
if (hasRoleFn < 1) { console.error('⛔ ABORT — current_user_role() 부재.'); process.exit(2); }

const colType = await scalar(`SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='designated_therapist_id';`);
console.log(`[introspect] customers.designated_therapist_id = ${colType || 'ABSENT'} (기대 uuid, FK→staff.id)`);
if (colType !== 'uuid') { console.error('⛔ ABORT — designated_therapist_id 컬럼 부재/타입불일치.'); process.exit(2); }

const trgPre = await scalar(`SELECT count(*)::int FROM pg_trigger WHERE tgname='${TRG}' AND NOT tgisinternal;`);
console.log(`[introspect] trigger ${TRG} (pre) = ${trgPre} (기대 0)`);

const pick = async (role) => scalar(`SELECT id::text FROM user_profiles WHERE role='${role}' AND COALESCE(active,true)=true ORDER BY id LIMIT 1;`);
const uid = {
  therapist:  await pick('therapist'),
  admin:      await pick('admin'),
  manager:    await pick('manager'),
  consultant: await pick('consultant'),
  coordinator:await pick('coordinator'),
};
console.log('\n[introspect] role별 실존 활성 user id (mask):');
for (const [r, v] of Object.entries(uid)) console.log(`  ${r.padEnd(11)}: ${v ? mask(v) : 'NONE'}`);

// 테스트 대상 customer + designated target staff (현재값과 다른 값 강제)
const custId = await scalar(`SELECT id::text FROM customers WHERE COALESCE(is_simulation,false)=false ORDER BY created_at DESC LIMIT 1;`);
const curDesig = await scalar(`SELECT COALESCE(designated_therapist_id::text,'') FROM customers WHERE id='${custId}';`);
// 현재값과 다른 실존 staff.id
const targetStaff = await scalar(`SELECT id::text FROM staff WHERE id::text <> '${curDesig || '00000000-0000-0000-0000-000000000000'}' ORDER BY id LIMIT 1;`);
console.log(`\n[introspect] test customer = ${mask(custId)} / 현재 designated = ${curDesig ? mask(curDesig) : 'NULL'} / target staff = ${mask(targetStaff)}`);
if (!custId || !targetStaff) { console.error('⛔ ABORT — 테스트 대상 customer/staff 확보 실패.'); process.exit(2); }

if (!APPLY) {
  console.log('\n── DRY 계획 ──');
  console.log(`  1) apply supabase/migrations/${MIG_FILE} (함수 ${FN}() + 트리거 ${TRG})`);
  console.log(`  2) recordLedger version=${VERSION}`);
  console.log('  3) 침투테스트 ①~⑤ (각 DO 끝 RAISE EXCEPTION → 무영속)');
  console.log('\n(실적용: --apply)');
  process.exit(0);
}

// ── 1. apply ──
console.log('\n════ [1] APPLY migration ════');
const sql = readFileSync(join(MIG_DIR, MIG_FILE), 'utf8');
await query(sql);
const fnPost = await scalar(`SELECT count(*)::int FROM pg_proc WHERE proname='${FN}';`);
const trgPost = await scalar(`SELECT count(*)::int FROM pg_trigger WHERE tgname='${TRG}' AND NOT tgisinternal;`);
console.log(`  function ${FN}() present = ${fnPost} (기대 1)`);
console.log(`  trigger  ${TRG} live    = ${trgPost} (기대 1)`);
if (trgPost < 1 || fnPost < 1) { console.error('⛔ apply 실패.'); process.exit(3); }
// 트리거 실제 결선(pg_trigger) 상세
const trgDef = await scalar(`SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='${TRG}' AND NOT tgisinternal LIMIT 1;`);
console.log(`  triggerdef: ${trgDef}`);
const led = await recordLedger({ version: VERSION, name: MIG_FILE.replace(/\.sql$/, ''), createdBy: 'dev-foot:T-20260725-DESIGNPT-WRITEBLOCK', dryRun: false });
console.log(`  ledger recorded = ${led.applied} (version ${VERSION})`);

// ── 2. 침투테스트 ①~⑤ ──
console.log('\n════ [2] 침투테스트 ①~⑤ (RAISE EXCEPTION → 전부 무영속) ════');

// role=null → service_role(jwt.claims 미설정). setStmt 는 UPDATE 문(세미콜론 없이).
async function attempt(label, { role, setStmt }) {
  const claim = role ? `PERFORM set_config('request.jwt.claims', json_build_object('sub','${uid[role]}')::text, true);` : `-- service_role: jwt.claims 미설정(auth.uid() NULL)`;
  const doBlock = `
DO $probe$
DECLARE v_cnt int;
BEGIN
  ${claim}
  ${setStmt};
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  RAISE EXCEPTION 'EVIDENCE|OK|rows=%', v_cnt;   -- 성공 경로: rows 를 실어 abort(무영속)
END $probe$;`;
  let verdict, detail;
  try {
    await query(doBlock);
    verdict = 'UNEXPECTED_COMMIT'; detail = '(RAISE 미도달 — 조사 필요)';
  } catch (e) {
    const m = String(e.message || e);
    if (/EVIDENCE\|OK\|rows=(\d+)/.test(m)) {
      verdict = 'OK'; detail = 'rows=' + m.match(/EVIDENCE\|OK\|rows=(\d+)/)[1];
    } else if (/42501|insufficient_privilege|관리자\/실장/.test(m)) {
      verdict = 'DENY_42501'; detail = (m.match(/요청 role=([a-z_]+)/) || [,''])[1] || '(role 표기)';
    } else {
      verdict = 'OTHER_ERR'; detail = m.slice(0, 200);
    }
  }
  return { label, role: role || 'service_role', verdict, detail };
}

const setDesig     = `UPDATE public.customers SET designated_therapist_id='${targetStaff}' WHERE id='${custId}'`;
const setDesigNoop = `UPDATE public.customers SET designated_therapist_id=(SELECT designated_therapist_id FROM public.customers WHERE id='${custId}') WHERE id='${custId}'`;
const setPhoneOnly = `UPDATE public.customers SET phone=phone WHERE id='${custId}'`; // designated 미포함 → 트리거 미발화

const results = [];
results.push(await attempt('① therapist→designated(값변경)', { role: 'therapist', setStmt: setDesig }));
for (const r of ['admin', 'manager', 'consultant', 'coordinator'])
  results.push(await attempt(`② ${r}→designated`, { role: r, setStmt: setDesig }));
results.push(await attempt('③ therapist→phone(only)',       { role: 'therapist', setStmt: setPhoneOnly }));
results.push(await attempt('④ therapist→designated(동일값)', { role: 'therapist', setStmt: setDesigNoop }));
results.push(await attempt('⑤ service_role→designated',      { role: null,        setStmt: setDesig }));

console.log('');
const expect = {
  '① therapist→designated(값변경)': 'DENY_42501',
  '② admin→designated': 'OK', '② manager→designated': 'OK', '② consultant→designated': 'OK', '② coordinator→designated': 'OK',
  '③ therapist→phone(only)': 'OK', '④ therapist→designated(동일값)': 'OK', '⑤ service_role→designated': 'OK',
};
let allPass = true;
for (const r of results) {
  const exp = expect[r.label];
  const pass = r.verdict === exp;
  if (!pass) allPass = false;
  console.log(`  ${pass ? '✅' : '❌'} ${r.label.padEnd(32)} [${r.role.padEnd(12)}] → ${r.verdict} ${r.detail} (기대 ${exp})`);
}

// 무영속 확인: 침투테스트 후 트리거 여전히 live + 대상 customer designated 불변
const desigAfter = await scalar(`SELECT COALESCE(designated_therapist_id::text,'') FROM customers WHERE id='${custId}';`);
const trgStillLive = await scalar(`SELECT count(*)::int FROM pg_trigger WHERE tgname='${TRG}' AND NOT tgisinternal;`);
console.log(`\n[post] 대상 customer designated 불변 = ${desigAfter === (curDesig || '')} (침투테스트 무영속)`);
console.log(`[post] trigger ${TRG} 여전히 live = ${trgStillLive} (기대 1)`);
console.log(`\n══ 결과: 침투테스트 ①~⑤ ${allPass ? 'ALL PASS ✅' : 'FAIL ❌'} / 트리거 prod live ${trgStillLive === 1 ? '✅' : '❌'} ══`);
process.exit(allPass && trgStillLive === 1 ? 0 : 1);
