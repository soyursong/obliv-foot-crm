-- T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC — 파트1 prod 데이터 정정 (APPLY)
-- F-4717 현은호: 분할결제 이체 leg 1,260,000 이 closing_manual_payments 에만 있고
--   canonical(package_payments) 미생성 → phantom 미수 1,260,000. 실제 전액 완납(카드 4,500,000 + 이체 1,260,000 = 5,760,000 = 24회권 total).
-- 정정 = 이체 leg 를 package_payments 로 정본화 + paid_amount 재집계 + manual 행 soft-void(이중계상 방지) → net-zero.
--   원장 무접점 · DDL 0(데이터정정) · 지문 교집합 freeze · 멱등 가드 · 롤백 SQL 동봉(_rollback.sql).
BEGIN;

-- (1) 이체 leg canonical 정본화 — 멱등 가드(NOT EXISTS: 동일 지문 재삽입 방지)
INSERT INTO public.package_payments
  (clinic_id, package_id, customer_id, amount, method, installment, payment_type, fee_kind, memo, created_at)
SELECT '74967aea-a60b-4da3-a0e7-9c997a930bc8',
       '9455ca84-5798-413b-bd45-7457616d7f55',
       '6412fbf7-8a53-4d49-af7a-491e1d731b4c',
       1260000, 'transfer', 0, 'payment', 'package',
       '분할결제 이체 leg 정본화 T-20260720-SPLITPAY-SYNC',
       '2026-07-20T16:03:00+09:00'
WHERE NOT EXISTS (
  SELECT 1 FROM public.package_payments
  WHERE package_id='9455ca84-5798-413b-bd45-7457616d7f55'
    AND amount=1260000 AND method='transfer'
    AND memo='분할결제 이체 leg 정본화 T-20260720-SPLITPAY-SYNC'
);

-- (2) packages.paid_amount 재집계 (환불 차감 반영 — 코드 write-path 동일 로직)
UPDATE public.packages SET paid_amount = (
  SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0)
  FROM public.package_payments WHERE package_id='9455ca84-5798-413b-bd45-7457616d7f55'
) WHERE id='9455ca84-5798-413b-bd45-7457616d7f55';

-- (3) closing_manual_payments soft-void — 이체 leg 이중계상 방지(net-zero). 지문 교집합 freeze.
UPDATE public.closing_manual_payments
  SET voided_at = now(),
      voided_reason = '분할결제 이체 leg 정본화(T-20260720-SPLITPAY-SYNC) — package_payments 반영으로 이중계상 방지',
      voided_by = 'dev-foot'
WHERE id='d38b38fb-a60d-41b1-91fa-05548c9f51bf'
  AND amount=1260000 AND method='transfer'
  AND chart_number='F-4717' AND close_date='2026-07-20'
  AND voided_at IS NULL;

COMMIT;
