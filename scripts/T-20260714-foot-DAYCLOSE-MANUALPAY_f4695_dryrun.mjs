/**
 * T-20260714-foot-DAYCLOSE-MANUAL-PAY-CUSTBOX-UNPAID-SYNC — 파트1 F-4695 이미현 정정 DRY-RUN
 * data_correction_backfill_sop: 대상 freeze + 스냅샷 + dry-run(무영속). 현장 확인 전 미반영.
 *
 * 대상 freeze (지문 교집합):
 *   customer_id = a07a3079-69ba-415a-a0f8-61e8d0921168 (chart F-4695, 이미현)
 *   package_id  = e55c868d-7b39-4b50-a98e-305d2353152d (12회권, total 2,890,000, paid 0)
 *   manual row  = d993ffc5-8c9b-4ef8-a1cf-df73b51aaba5 (2,890,000 card, 송지현, 11:09, close_date 2026-07-14)
 *
 * READ-ONLY. author: dev-foot / 2026-07-14
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
const out = {};

// package_payments 스키마 — fee_kind 컬럼 확인(미수 산출 정합)
out.pp_cols = await q(`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='package_payments'
  ORDER BY ordinal_position;`);

// BEFORE: 미수 산출 재현 (loadCustomerOutstanding 로직 = total_amount - Σ(package fee_kind payments))
out.before = await q(`
  SELECT pk.id, pk.package_name, pk.total_amount, pk.consultation_fee, pk.paid_amount,
         COALESCE((SELECT SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)
                   FROM public.package_payments pp
                   WHERE pp.package_id = pk.id
                     AND COALESCE(pp.fee_kind,'package')='package'),0) AS net_pkg_paid,
         pk.total_amount - COALESCE((SELECT SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)
                   FROM public.package_payments pp
                   WHERE pp.package_id = pk.id
                     AND COALESCE(pp.fee_kind,'package')='package'),0) AS package_due
  FROM public.packages pk WHERE pk.id = '${PKG}';`);

console.log('=== package_payments columns ===');
console.log(JSON.stringify(out.pp_cols.map(c=>c.column_name)));
console.log('\n=== BEFORE (F-4695 12회권 미수) ===');
console.log(JSON.stringify(out.before, null, 2));

console.log('\n=== DRY-RUN 정정안 (미반영 — 현장 확인 후 apply) ===');
console.log(`
-- STEP 1: 12회권 package 결제(2,890,000 card) 정본 기록 (manual→canonical 이전)
INSERT INTO public.package_payments
  (clinic_id, package_id, customer_id, amount, method, installment, payment_type, fee_kind, memo, created_at)
VALUES
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '${PKG}', '${CUST}',
   2890000, 'card', 0, 'payment', 'package',
   '수기입력 정본화(T-20260714 F-4695 이미현)', '2026-07-14T11:09:00+09:00');

-- STEP 2: packages.paid_amount 재집계
UPDATE public.packages SET paid_amount = 2890000 WHERE id = '${PKG}';

-- STEP 3: 이중계상 방지 — 정본화된 수기 결제행(2,890,000) 제거
DELETE FROM public.closing_manual_payments WHERE id = 'd993ffc5-8c9b-4ef8-a1cf-df73b51aaba5';
`);

console.log('=== ROLLBACK SQL ===');
console.log(`
DELETE FROM public.package_payments
 WHERE package_id='${PKG}' AND customer_id='${CUST}' AND amount=2890000
   AND memo='수기입력 정본화(T-20260714 F-4695 이미현)';
UPDATE public.packages SET paid_amount = 0 WHERE id = '${PKG}';
INSERT INTO public.closing_manual_payments
  (id, clinic_id, close_date, pay_time, chart_number, customer_name, staff_name, amount, method, memo)
VALUES ('d993ffc5-8c9b-4ef8-a1cf-df73b51aaba5','74967aea-a60b-4da3-a0e7-9c997a930bc8',
  '2026-07-14','11:09','F-4695','이미현','송지현',2890000,'card',NULL);
`);

console.log('예상 결과: package_due 2,890,000 → 0 (고객박스 미수 해소). 2번차트 수납내역에 package_payments 1건 표기. 일마감 총계 불변(manual 2,890,000 제거 = package 2,890,000 신설, net 0).');
