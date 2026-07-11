/**
 * T-20260708-foot-REDPAY-CLOSING-TAB — 뷰3곳 stale-13 → 17-set/merchant_id 피벗 prod 동기
 *
 * m5ho FIX-REQUEST(17-set 8곳 동기) 중 뷰3곳(read-layer) 을 prod 에 CREATE OR REPLACE 적용.
 *   1. v_redpay_reconciliation_daily   (20260708230000)  — WHERE merchant_id 17(1차)+TID 17(보조)
 *   2. get_redpay_feed_freshness()     (20260708230000)  — foot_merchants CTE + merchant 필터
 *   3. v_receipt_settlement_daily      (20260710120000)  — rp 조인/freshness merchant_id 피벗
 *
 * ADDITIVE(CREATE OR REPLACE, 시그니처/컬럼·반환형 불변 = WHERE 필터만 확장). DA GO(tjtk).
 * autonomy §3.1: CEO 게이트 불요. supervisor DDL-diff 만.
 *
 * 사용:
 *   node scripts/..._viewsync_apply.mjs           # dry-run (SQL 미리보기)
 *   node scripts/..._viewsync_apply.mjs --apply   # PROD 적용
 *
 * author: dev-foot / 2026-07-11
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { query, MIG_DIR } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');

// ── 1) daily_view 파일 전체 (전량 CREATE OR REPLACE VIEW/FUNC + COMMENT + GRANT = idempotent) ──
const dailyFile = '20260708230000_redpay_recon_daily_view.sql';
const dailySql = readFileSync(join(MIG_DIR, dailyFile), 'utf8');

// ── 2) OCR 파일에서 v_receipt_settlement_daily 뷰 블록만 추출 (ALTER TABLE ADD CONSTRAINT 재실행 회피) ──
const ocrFile = '20260710120000_ocr_receipt_redpay_match.sql';
const ocrSql = readFileSync(join(MIG_DIR, ocrFile), 'utf8');
const start = ocrSql.indexOf('CREATE OR REPLACE VIEW public.v_receipt_settlement_daily');
const grantMarker = 'GRANT SELECT ON public.v_receipt_settlement_daily TO authenticated;';
const end = ocrSql.indexOf(grantMarker) + grantMarker.length;
if (start < 0 || end < grantMarker.length) throw new Error('v_receipt_settlement_daily 블록 추출 실패');
const settleSql = ocrSql.slice(start, end);

console.log(`── 뷰3곳 prod 동기 (${APPLY ? 'APPLY' : 'DRY-RUN'}) ──`);
console.log(`  [A] ${dailyFile}: v_redpay_reconciliation_daily + get_redpay_feed_freshness() (파일 전체, ${dailySql.length}B)`);
console.log(`  [B] ${ocrFile}: v_receipt_settlement_daily 뷰 블록만 (${settleSql.length}B)`);

if (!APPLY) {
  console.log('\n[dry-run] --apply 미지정 → prod write 없음.');
  console.log('\n===== [B] settle view 블록 head =====');
  console.log(settleSql.slice(0, 400));
  process.exit(0);
}

// ── 적용 ──
console.log('\n[A] daily_view 적용...');
await query(dailySql);
console.log('  ✓ v_redpay_reconciliation_daily + get_redpay_feed_freshness() CREATE OR REPLACE 완료');

console.log('[B] settle view 적용...');
await query(settleSql);
console.log('  ✓ v_receipt_settlement_daily CREATE OR REPLACE 완료');

// ── 검증: prod 뷰 정의에 17-set(merchant 1777285001 + 09:40 라이브 TID 1047479255) 반영 확인 ──
console.log('\n── 검증(prod 뷰 정의 grep) ──');
const checks = [
  ['v_redpay_reconciliation_daily', '1777285001', '1047479255'],
  ['v_receipt_settlement_daily', '1777285001', '1047479255'],
];
for (const [view, merchant, tid] of checks) {
  const rows = await query(`SELECT pg_get_viewdef('public.${view}'::regclass) AS def;`);
  const def = rows?.[0]?.def || '';
  const okM = def.includes(merchant);
  const okT = def.includes(tid);
  console.log(`  ${view}: merchant ${merchant}=${okM ? '✓' : '✗'} / TID ${tid}=${okT ? '✓' : '✗'}`);
  if (!okM || !okT) { console.error(`  ✗ ${view} 17-set 미반영`); process.exit(1); }
}
// freshness func: 소스에 merchant CTE 존재 확인
const fn = await query(`SELECT pg_get_functiondef('public.get_redpay_feed_freshness()'::regprocedure) AS def;`);
const fnDef = fn?.[0]?.def || '';
console.log(`  get_redpay_feed_freshness(): foot_merchants CTE=${fnDef.includes('foot_merchants') ? '✓' : '✗'} / 1777285001=${fnDef.includes('1777285001') ? '✓' : '✗'}`);
if (!fnDef.includes('foot_merchants') || !fnDef.includes('1777285001')) { console.error('  ✗ freshness 미반영'); process.exit(1); }

console.log('\n✅ 뷰3곳 prod 동기 완료 — 17-set/merchant_id 피벗 반영.');
process.exit(0);
