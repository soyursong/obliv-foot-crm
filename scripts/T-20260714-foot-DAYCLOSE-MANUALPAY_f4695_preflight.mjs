/**
 * T-20260714-foot-DAYCLOSE-MANUAL-PAY-CUSTBOX-UNPAID-SYNC — 파트1 F-4695 APPLY 전 PREFLIGHT (READ-ONLY)
 * data_correction_backfill_sop: apply 직전 freeze 재검증 + abort-guard.
 *
 * 07-14 진단 시점 대비 07-15 apply 시점의 상태 drift 를 재검증한다.
 *   G1 manual row d993ffc5 여전히 존재 (이미 정정/삭제됐으면 abort)
 *   G2 package_payments(package fee_kind) 여전히 0행 (누가 이미 결제 넣었으면 abort — 이중 방지)
 *   G3 package_due 여전히 2,890,000 (금액 drift 시 abort)
 *   G4 daily_closings 2026-07-14 여전히 미확정 (확정됐으면 원장 접점 → abort, planner FOLLOWUP)
 *
 * 하나라도 FAIL → apply 금지. author: dev-foot / 2026-07-15
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
const MANUAL = 'd993ffc5-8c9b-4ef8-a1cf-df73b51aaba5';

const fails = [];

// G1 — manual row still present + FULL row capture (정확한 rollback 근거)
const manualRow = await q(`SELECT * FROM public.closing_manual_payments WHERE id='${MANUAL}';`);
console.log('=== G1: manual row d993ffc5 (FULL, rollback 근거) ===');
console.log(JSON.stringify(manualRow, null, 2));
if (manualRow.length !== 1) fails.push('G1 FAIL: manual row d993ffc5 부재/중복 — 이미 정정됐거나 삭제됨');
else if (Number(manualRow[0].amount) !== 2890000) fails.push(`G1 FAIL: manual amount drift = ${manualRow[0].amount}`);

// G2 — package_payments (package fee_kind) still 0 rows
const pp = await q(`
  SELECT id, amount, fee_kind, payment_type, created_at, memo FROM public.package_payments
  WHERE package_id='${PKG}';`);
console.log('\n=== G2: package_payments rows for PKG (기대 0행) ===');
console.log(JSON.stringify(pp, null, 2));
if (pp.length !== 0) fails.push(`G2 FAIL: package_payments 이미 ${pp.length}행 존재 — 이중계상 위험, 대상 drift`);

// G3 — package_due still 2,890,000 (loadCustomerOutstanding 재현)
const due = await q(`
  SELECT pk.id, pk.package_name, pk.total_amount, pk.paid_amount,
         pk.total_amount - COALESCE((SELECT SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)
                   FROM public.package_payments pp WHERE pp.package_id=pk.id
                     AND COALESCE(pp.fee_kind,'package')='package'),0) AS package_due
  FROM public.packages pk WHERE pk.id='${PKG}';`);
console.log('\n=== G3: package_due (기대 2,890,000) ===');
console.log(JSON.stringify(due, null, 2));
if (due.length !== 1) fails.push('G3 FAIL: package 부재');
else if (Number(due[0].package_due) !== 2890000) fails.push(`G3 FAIL: package_due drift = ${due[0].package_due}`);

// G4 — daily_closings 2026-07-14 still 미확정 (원장 접점 abort)
const dc = await q(`
  SELECT * FROM public.daily_closings
  WHERE close_date='2026-07-14' AND clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8';`);
console.log('\n=== G4: daily_closings 2026-07-14 (기대 0행=미확정) ===');
console.log(JSON.stringify(dc, null, 2));
if (dc.length !== 0) fails.push(`G4 FAIL: 일마감 2026-07-14 확정됨(${dc.length}행) — closing_manual_payments DELETE 는 원장 접점 → ABORT, planner FOLLOWUP 필요`);

console.log('\n================ PREFLIGHT VERDICT ================');
if (fails.length === 0) {
  console.log('PASS ✅ — 4 guards 통과. apply 진행 안전.');
} else {
  console.log('ABORT ❌ — apply 금지:');
  fails.forEach(f => console.log('  - ' + f));
  process.exitCode = 2;
}
