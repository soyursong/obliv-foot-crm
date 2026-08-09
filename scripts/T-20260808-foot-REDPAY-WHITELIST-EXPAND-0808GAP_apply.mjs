/**
 * T-20260808-foot-REDPAY-WHITELIST-EXPAND-0808GAP — 288002 신규 merchant admission apply
 *   마이그: 20260808090000_redpay_foot_registry_0808gap_admission.sql (ADDITIVE 1행, 멱등, no-DDL data-lane).
 *   DA CONSULT admission GO=MSG-20260809-093611-t9eu · supervisor DB-GATE GO-token 발효(MSG-20260809-134234-1130).
 *   대표 게이트 면제(autonomy §3.1, ADDITIVE·DA GO). byte-pin 아티팩트 fef1e3c1.
 *
 * usage: node scripts/T-20260808-...apply.mjs          (DRY 계획 + before 카운트 + VG1/VG2 재-freeze)
 *        node scripts/T-20260808-...apply.mjs --apply  (실적용 + G3 rows-affected==1 + after 검증)
 * author: dev-foot / 2026-08-09
 */
import { query, applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(실적용)' : 'DRY(계획만)';
const VERSION = '20260808090000';
const FILE = '20260808090000_redpay_foot_registry_0808gap_admission.sql';
const MERCH = '1777288002';
const NEW_TID = '1047538234';
const SIBLING_0806 = '1777288007'; // VG2: 27번째 interim = 0806GAP
const EXPECT_BASELINE = 27;        // VG1 (DA 확정)

const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] 0808GAP 288002 신규 merchant admission — ref rxlomoozakkjesdqjtvd`);
console.log('════════════════════════════════════════════════════════════\n');

// ── precheck: 테이블 실재 ──
const reg = await scalar("SELECT to_regclass('public.redpay_terminal_registry') AS v;");
if (!reg) { console.error('⛔ ABORT — redpay_terminal_registry 테이블 부재.'); process.exit(4); }

// ── before 카운트 + VG1/VG2 seed-직전 재-freeze (BLOCKING) ──
const footBefore   = Number(await scalar("SELECT count(*)::int AS n FROM public.redpay_terminal_registry WHERE domain='foot' AND active;"));
const merchBefore  = Number(await scalar(`SELECT count(*)::int AS n FROM public.redpay_terminal_registry WHERE merchant_id='${MERCH}';`));
const tidBefore    = Number(await scalar(`SELECT count(*)::int AS n FROM public.redpay_terminal_registry WHERE tid='${NEW_TID}' OR superseded_tids && ARRAY['${NEW_TID}'];`));
const sib0806      = Number(await scalar(`SELECT count(*)::int AS n FROM public.redpay_terminal_registry WHERE domain='foot' AND active AND merchant_id='${SIBLING_0806}';`));
const ledgerBefore = (await ledgerVersions()).has(VERSION);

console.log(`── [before] foot active=${footBefore} (VG1 기대 ${EXPECT_BASELINE}) · merchant_present(288002)=${merchBefore} (기대 0) · new_tid_present=${tidBefore} (기대 0) · 288007(VG2)=${sib0806} (기대 1) · ledger(${VERSION})=${ledgerBefore}`);

// ★ BLOCKING pre-asserts (seed 직전 불변)
if (merchBefore !== 0) { console.error('⛔ ABORT(VG1) — 288002 이미 존재. 신규 admission 아님(double-INSERT/remap 재검토).'); process.exit(3); }
if (tidBefore !== 0)   { console.error('⛔ ABORT — tid 538234 가 이미 registry 에 존재(remap 후보). 재-CONSULT.'); process.exit(3); }
if (footBefore !== EXPECT_BASELINE) { console.error(`⛔ ABORT(VG1) — foot active baseline=${footBefore} ≠ ${EXPECT_BASELINE}. seed 전 supervisor baseline 재-freeze 필요.`); process.exit(3); }
if (sib0806 !== 1)     { console.error('⛔ ABORT(VG2) — 288007(0806GAP interim) 부재/다중. 27번째 drift 원인 재확인·재-CONSULT.'); process.exit(3); }
console.log('   ✅ VG1/VG2 pre-assert PASS (288002 신규·순수 신규 tid·baseline 27·288007 interim 확인).');

if (!APPLY) {
  console.log(`\n── [DRY] 적용 계획: ${FILE} (288002 신규 INSERT, ON CONFLICT(merchant_id) DO NOTHING, rows-affected==1).`);
  console.log('실적용: --apply 플래그.\n');
  process.exit(0);
}

// ── APPLY ──
try {
  console.log(`\n▶ APPLY ${VERSION}  ${FILE}`);
  const r = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'T-20260808-redpay-0808gap-admission' });
  console.log(`  ✅ applied + ledger recorded (${r.name})`);
} catch (e) {
  console.error(`\n⛔ FAIL @ ${VERSION}: ${e.message}`);
  process.exit(3);
}

// ── after 검증 (G3 rows-affected==1 대응: merchant 0→1, foot 27→28, ledger 0→1) ──
const footAfter   = Number(await scalar("SELECT count(*)::int AS n FROM public.redpay_terminal_registry WHERE domain='foot' AND active;"));
const merchAfter  = Number(await scalar(`SELECT count(*)::int AS n FROM public.redpay_terminal_registry WHERE merchant_id='${MERCH}';`));
const ledgerAfter = (await ledgerVersions()).has(VERSION);
const row = await query(`SELECT merchant_id, tid, terminal_label, domain, active FROM public.redpay_terminal_registry WHERE merchant_id='${MERCH}';`);

console.log(`\n── [after] foot active=${footAfter} (기대 28) · merchant_present(288002)=${merchAfter} (기대 1) · ledger(${VERSION})=${ledgerAfter} (기대 true)`);
for (const p of (Array.isArray(row) ? row : [])) console.log(`     ${p.merchant_id}  ${p.tid}  ${p.terminal_label}  domain=${p.domain} active=${p.active}`);

let fail = false;
if (merchAfter !== 1)                  { console.error('⛔ POST-FAIL — merchant_present ≠ 1 (silent write-fail?).'); fail = true; }
if (footAfter !== footBefore + 1)      { console.error(`⛔ POST-FAIL — foot active ${footBefore}→${footAfter} (기대 +1).`); fail = true; }
if (!ledgerAfter)                      { console.error('⛔ POST-FAIL — ledger 미기록.'); fail = true; }
if (fail) process.exit(3);

console.log('\n✅ G3 PASS — 288002 admission 영속 확정 (merchant 0→1, foot 27→28, ledger 0→1).');
console.log('   다음: env merchant-add(旣완료) → daily_full 재폴링 8/06~8/09 → 뷰 0→3/₩260,000 소급 표면화.');
console.log('\n[DONE]');
