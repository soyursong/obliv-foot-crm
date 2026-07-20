-- T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC — 파트1 정정 롤백
-- apply 를 완전 역전: 정본화 행 삭제 + paid_amount 원복 + manual soft-void 해제.
BEGIN;

-- (1) 정본화한 이체 leg 삭제 (지문 교집합 — 다른 결제행 오삭제 방지)
DELETE FROM public.package_payments
WHERE package_id='9455ca84-5798-413b-bd45-7457616d7f55'
  AND amount=1260000 AND method='transfer'
  AND memo='분할결제 이체 leg 정본화 T-20260720-SPLITPAY-SYNC';

-- (2) paid_amount 재집계(삭제 반영 → 4,500,000 로 원복)
UPDATE public.packages SET paid_amount = (
  SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0)
  FROM public.package_payments WHERE package_id='9455ca84-5798-413b-bd45-7457616d7f55'
) WHERE id='9455ca84-5798-413b-bd45-7457616d7f55';

-- (3) manual soft-void 해제(원상 복구 — 다시 일마감 합산 포함)
UPDATE public.closing_manual_payments
  SET voided_at = NULL, voided_reason = NULL, voided_by = NULL
WHERE id='d38b38fb-a60d-41b1-91fa-05548c9f51bf';

COMMIT;
