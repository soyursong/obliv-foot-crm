-- ROLLBACK T-20260616-foot-PKG-OUTSTANDING-BALANCE
-- 완전 가역: ADD COLUMN 의 역연산. 데이터 손실 = 신규 컬럼에 담긴 진료비/귀속 값에 한정
--   (롤백 전제 = 기능 미사용 또는 폐기). 기존 컬럼(total_amount/paid_amount/amount) 무접촉.

BEGIN;

ALTER TABLE public.package_payments
  DROP CONSTRAINT IF EXISTS package_payments_fee_kind_check;

ALTER TABLE public.package_payments
  DROP COLUMN IF EXISTS fee_kind;

ALTER TABLE public.packages
  DROP COLUMN IF EXISTS consultation_fee;

COMMIT;
