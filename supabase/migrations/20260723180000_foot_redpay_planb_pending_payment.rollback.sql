-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260723-foot-REDPAY-PLANB-DDL-BUILD (20260723180000_foot_redpay_planb_pending_payment.sql)
-- ══════════════════════════════════════════════════════════════════
-- ADDITIVE 순증분의 정확한 역연산. DROP TABLE 이 종속 인덱스·트리거·정책·제약을 함께 제거.
--   ⚠ 선점행(pending_payment)이 있으면 소실 → 운영 롤백 시 supervisor 가 행 백업 여부 사전확인.
--   무접촉: payments/redpay_raw_transactions/customers/check_ins/clinics/set_updated_at() 원본 미변경.
-- 멱등: DROP ... IF EXISTS (재실행 무해).
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- 정책·트리거는 테이블 DROP 에 종속 제거되나, 멱등·명시성을 위해 선DROP.
DROP POLICY  IF EXISTS pending_payment_rw_own_clinic ON public.pending_payment;
DROP TRIGGER IF EXISTS pending_payment_updated_at    ON public.pending_payment;

-- 테이블(인덱스 pending_payment_open_uq / pending_payment_match_idx 는 종속 제거).
DROP TABLE IF EXISTS public.pending_payment;

COMMIT;
