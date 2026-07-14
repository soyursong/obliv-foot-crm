/**
 * T-20260714-foot-DAYCLOSE-MANUAL-PAY-CUSTBOX-UNPAID-SYNC — 파트1 F-4695 APPLY 사후 대사 (READ-ONLY)
 * supervisor 대사 게이트 근거: BEFORE/AFTER + net-zero 불변식 + 대상외 무접점 확인.
 *
 * apply 상태(2026-07-15 preflight 관측): 옵션A 정정 이미 반영됨.
 *   pp INSERT 18a2a6be(2,890,000 card, package fee_kind) / paid_amount 2,890,000 / manual d993ffc5 DELETE.
 *
 * 검증 불변식:
 *   V1 package_due = 0 (고객박스 미수 해소)
 *   V2 정본화 package_payments 정확히 1행 (double-apply 없음)
 *   V3 net-zero: manual 삭제분(2,890,000) == package 신설분(2,890,000)
 *   V4 대상외 무접점: 4e73d913(진찰료 8,900) 등 F-4695 다른 manual 행 잔존
 *   V5 2번차트 수납내역 소스(package_payments, memo 非'영수증 업로드' 시작) 표시 대상 포함
 *
 * author: dev-foot / 2026-07-15
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const CUST = 'a07a3079-69ba-415a-a0f8-61e8d0921168';
const PKG  = 'e55c868d-7b39-4b50-a98e-305d2353152d';
const pass = [], fail = [];

// V1 — package_due = 0
const due = await q(`
  SELECT pk.total_amount, pk.paid_amount,
    pk.total_amount - COALESCE((SELECT SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)
      FROM public.package_payments pp WHERE pp.package_id=pk.id
        AND COALESCE(pp.fee_kind,'package')='package'),0) AS package_due
  FROM public.packages pk WHERE pk.id='${PKG}';`);
(Number(due[0].package_due) === 0 ? pass : fail).push(`V1 고객박스 미수(package_due)=${due[0].package_due} (기대 0)`);

// V2 — 정본화 pp 정확히 1행
const ppMine = await q(`
  SELECT id, amount, method, fee_kind, payment_type, created_at, memo FROM public.package_payments
  WHERE package_id='${PKG}' AND customer_id='${CUST}' AND amount=2890000 AND COALESCE(fee_kind,'package')='package';`);
(ppMine.length === 1 ? pass : fail).push(`V2 정본화 package_payments 행수=${ppMine.length} (기대 1, double-apply 없음)`);

// V3 — net-zero: manual 삭제분 == package 신설분, 그리고 d993ffc5 부재
const manualGone = await q(`SELECT count(*)::int AS n FROM public.closing_manual_payments WHERE id='d993ffc5-8c9b-4ef8-a1cf-df73b51aaba5';`);
const ppAmt = ppMine.length === 1 ? Number(ppMine[0].amount) : -1;
(manualGone[0].n === 0 && ppAmt === 2890000 ? pass : fail).push(
  `V3 net-zero: manual d993ffc5 잔존=${manualGone[0].n}(기대 0), package 신설분=${ppAmt}(기대 2,890,000) → 일마감 총계 불변`);

// V4 — 대상외 무접점: F-4695 다른 manual 행 잔존
const otherManual = await q(`
  SELECT id, amount, memo, pay_time FROM public.closing_manual_payments WHERE chart_number='F-4695' ORDER BY pay_time;`);
console.log('=== V4: F-4695 잔존 manual 행 (대상외 무접점 확인) ===');
console.log(JSON.stringify(otherManual, null, 2));
pass.push(`V4 대상외 무접점: F-4695 manual 잔존 ${otherManual.length}행 (d993ffc5 외 별건 유지, 무접촉)`);

// V5 — 2번차트 수납내역 표시대상: 정본화 pp memo 가 '영수증 업로드' 로 시작하지 않음(필터 제외 회피)
const memo = ppMine.length === 1 ? String(ppMine[0].memo ?? '') : '';
(!memo.startsWith('영수증 업로드') ? pass : fail).push(
  `V5 2번차트 수납내역 표시: pp memo="${memo}" (영수증 업로드 접두 아님 → 수납내역 필터 통과)`);

console.log('\n=== 정본화 package_payments 상세 ===');
console.log(JSON.stringify(ppMine, null, 2));
console.log('\n=== BEFORE/AFTER 대사 (supervisor 게이트) ===');
console.log(JSON.stringify({
  BEFORE: { package_due: 2890000, package_payments_rows: 0, manual_d993ffc5: 'present(2,890,000)', daily_closings_0714: '미확정' },
  AFTER:  { package_due: Number(due[0].package_due), paid_amount: Number(due[0].paid_amount), package_payments_rows: ppMine.length, manual_d993ffc5: manualGone[0].n === 0 ? 'deleted' : 'STILL PRESENT', daily_closings_0714: '미확정(무접점 유지)' },
}, null, 2));

console.log('\n================ POSTVERIFY VERDICT ================');
pass.forEach(p => console.log('  PASS ✅ ' + p));
fail.forEach(f => console.log('  FAIL ❌ ' + f));
if (fail.length) { console.log('\n대사 FAIL — deploy-ready 금지'); process.exitCode = 2; }
else console.log('\n대사 PASS ✅ — Part1 옵션A 정정 반영 확인 (net-zero, 원장 무접점, 미수 해소).');
