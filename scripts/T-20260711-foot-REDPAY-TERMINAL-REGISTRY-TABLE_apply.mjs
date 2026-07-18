/**
 * T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE — redpay family 순서 apply + body-seed 리페어
 * FIX-REQUEST MSG-20260718-022303-rvh4 (supervisor Option A GO + Ledger Reconciliation 범위 확대).
 *
 * ── BEFORE 실측(introspect_BEFORE.log) 결론 ──
 *   redpay family 5종 = ledger ABSENT + object ABSENT 전량. silent-SKIP hazard 未발생(20260714170100
 *   ledger도 ABSENT → forward apply 로 실제 seed 가능). = 단순 2건 drift 아닌 family 전량 미적용.
 *   ∴ 정답 = forward-apply 전량(순서) via applyMigration 헬퍼(= 적용+원장기록 단일경로, orphan 원장 0).
 *   registry 테이블이 20260711 로 선생성 → 20260714170100 to_regclass 가드 통과 → body 14-band 실제 seed.
 *
 * ── 순서(timestamp = 의존순 정합, 엄수) ──
 *   20260710120000(payments cols)  → 20260711140000(registry+foot17+뷰)
 *   → 20260714170000(paylog center) → 20260714170100(body 14 seed) → 20260714210000(body 뷰/role)
 *
 * ── fail-closed 게이트 ──
 *   (조치3) 20260710 apply 직전 receipt_ocr_results total/raw_text~[0-9]{13,} 재실측. >0 즉시 abort.
 *   20260714170100 직전 registry 실존 재확인. 각 마이그 실패 시 체인 중단 + 적용현황 보고.
 *
 * usage: node scripts/T-20260711-...apply.mjs          (DRY 계획만)
 *        node scripts/T-20260711-...apply.mjs --apply  (실적용)
 * PROD write = supervisor Option A GO(MSG-20260718-022303-rvh4) 경유.
 * author: dev-foot / 2026-07-18
 */
import { query, applyMigration } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(실적용)' : 'DRY(계획만)';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};

const CHAIN = [
  { version: '20260710120000', file: '20260710120000_ocr_receipt_redpay_match.sql', note: 'payments.image_url/ocr_receipt_datetime + receipt_ocr_results.parsed_approval_no + no_full_pan CHECK(NOT VALID→VALIDATE) + v_receipt_settlement_daily + 멱등 idx' },
  { version: '20260711140000', file: '20260711140000_redpay_terminal_registry_ssot.sql', note: 'redpay_terminal_registry 테이블 + foot 17 seed + 뷰3 registry-파생 재정의 + 미분류 알람뷰' },
  { version: '20260714170000', file: '20260714170000_paylog_center_column.sql', note: 'payment_reconciliation_log.center(NOT NULL DEFAULT foot) + CHECK + idx' },
  { version: '20260714170100', file: '20260714170100_redpay_dohsu_registry_seed.sql', note: 'body(도수) 14-band seed → registry (테이블 실존 → to_regclass 가드 통과 → 실제 seed)' },
  { version: '20260714210000', file: '20260714210000_redpay_body_recon_view_grant.sql', note: 'v_redpay_reconciliation_body(center=body 하드필터) + role body_recon_ro(passwordless=inert)' },
];

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] redpay family 순서 apply — ref rxlomoozakkjesdqjtvd (${nowKst()})`);
console.log('  order: ' + CHAIN.map((c) => c.version).join(' → '));
console.log('════════════════════════════════════════════════════════════\n');

// ── 조치3: VALIDATE fail-closed 프리체크 (20260710 apply 직전 재실측) ──
console.log('── [gate] VALIDATE fail-closed precheck (직전 재실측) ──');
const roTotal = await scalar('SELECT count(*)::int AS n FROM public.receipt_ocr_results;');
const roPan = await scalar("SELECT count(*)::int AS n FROM public.receipt_ocr_results WHERE raw_text ~ '[0-9]{13,}';");
console.log(`  receipt_ocr_results total=${roTotal}, raw_text~[0-9]{13,}=${roPan}`);
if (roPan > 0) {
  console.error(`\n⛔ ABORT — PCI regex count=${roPan} > 0. 0 실측 전제 붕괴 → VALIDATE 강행 금지. supervisor 보고.`);
  process.exit(2);
}
console.log('  ✅ SAFE — no_full_pan VALIDATE 통과 가능. 체인 진행.\n');

if (!APPLY) {
  console.log('── [DRY] 적용 계획 (실적용 없음) ──');
  for (const c of CHAIN) console.log(`  ${c.version}  ${c.file}\n    ↳ ${c.note}`);
  console.log('\n실적용: --apply 플래그.\n');
  process.exit(0);
}

// ── 순서 apply (one-at-a-time, fail-closed) ──
const applied = [];
for (const c of CHAIN) {
  if (c.version === '20260714170100') {
    const reg = await scalar("SELECT to_regclass('public.redpay_terminal_registry') AS v;");
    console.log(`  [precheck] redpay_terminal_registry = ${reg ?? 'ABSENT'} (body seed to_regclass 가드)`);
    if (!reg) {
      console.error('⛔ ABORT — registry 부재 상태로 body seed 진입(silent-SKIP 재발 위험). 체인 중단.');
      process.exit(4);
    }
  }
  try {
    console.log(`\n▶ APPLY ${c.version}  ${c.file}`);
    const r = await applyMigration({ version: c.version, file: c.file, dryRun: false, createdBy: 'T-20260711-redpay-family-reconcile' });
    console.log(`  ✅ applied + ledger recorded (${r.name})`);
    applied.push(c.version);
    if (c.version === '20260711140000') {
      const foot = await scalar("SELECT count(*)::int AS n FROM public.redpay_terminal_registry WHERE domain='foot';");
      console.log(`    ↳ registry foot count = ${foot} (기대 17)`);
    }
    if (c.version === '20260714170100') {
      const body = await scalar("SELECT count(*)::int AS n FROM public.redpay_terminal_registry WHERE domain='body';");
      console.log(`    ↳ registry body count = ${body} (기대 14)`);
    }
  } catch (e) {
    console.error(`\n⛔ FAIL @ ${c.version}: ${e.message}`);
    console.error(`   Management API 단일 txn → 본 파일 롤백. 적용완료: [${applied.join(', ')}]. 체인 중단 + supervisor 보고.`);
    process.exit(3);
  }
}

console.log(`\n════════════════════════════════════════════════════════════`);
console.log(`[DONE] applied in order: ${applied.join(' → ')}  (${nowKst()})`);
console.log(`AFTER 검증: introspect --tag AFTER`);
console.log('════════════════════════════════════════════════════════════');
