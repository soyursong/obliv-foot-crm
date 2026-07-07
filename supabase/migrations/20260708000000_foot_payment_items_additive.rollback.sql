-- ROLLBACK: T-20260707-foot-PAYMENT-ITEMIZED-CHARGE-ENTRY
-- 20260708000000_foot_payment_items_additive.sql 되돌리기.
--
-- ADDITIVE 순수 신규 테이블 → DROP 만으로 완전 복원.
-- payments/check_ins/services/user_profiles 등 기존 테이블 무변경이었으므로 회귀 0.
-- payment_items 행은 결제 display 세부일 뿐(매출/EDI/마감/인센티브 SSOT 미진입) → 삭제해도 매출 정합 무손실.

BEGIN;

DROP POLICY IF EXISTS payment_items_clinic_isolation ON public.payment_items;
DROP TABLE IF EXISTS public.payment_items CASCADE;

COMMIT;
