-- ══════════════════════════════════════════════════════════════════
-- [ROLLBACK] T-20260607-foot-REDPAY-PORT — pay_recon_port
-- ══════════════════════════════════════════════════════════════════
-- 순서: 신규 테이블 DROP → payments 신규 컬럼 제거.
-- 실행 전: 운영 적용 여부 + 매칭 데이터 존재 여부 확인 필수.
--   SELECT COUNT(*) FROM payments WHERE reconciled_at IS NOT NULL;  -- 0 권장
--
-- ⚠️ external_approval_no / external_tid 는 본 마이그레이션 소유가 아님
--    (20260523040000_pay_external_fields — 데스크 결제 입력 UI). DROP 금지.
-- ══════════════════════════════════════════════════════════════════

-- 1. M2 무결성 제약 제거
ALTER TABLE public.redpay_raw_transactions DROP CONSTRAINT IF EXISTS redpay_raw_match_rule_check;
ALTER TABLE public.payment_reconciliation_log DROP CONSTRAINT IF EXISTS recon_log_match_rule_check;
DROP INDEX IF EXISTS public.payments_external_trxid_unique;
DROP INDEX IF EXISTS public.redpay_raw_matched_payment_unique;

-- 2. 폴러 상태 테이블 DROP
DROP TABLE IF EXISTS public.redpay_poller_state CASCADE;

-- 3. 이벤트 로그 테이블 DROP
DROP TABLE IF EXISTS public.payment_reconciliation_log CASCADE;

-- 4. 원시 데이터 적재 테이블 DROP (트리거/함수 포함)
DROP TRIGGER IF EXISTS redpay_raw_updated_at_trigger ON public.redpay_raw_transactions;
DROP TABLE IF EXISTS public.redpay_raw_transactions CASCADE;
DROP FUNCTION IF EXISTS public.set_redpay_raw_updated_at();

-- 5. payments 신규 컬럼 제거 (본 마이그레이션이 추가한 4종만)
--    external_approval_no / external_tid 는 유지 (타 마이그레이션 소유).
DROP INDEX IF EXISTS public.payments_unreconciled_idx;
DROP INDEX IF EXISTS public.payments_external_trxid_idx;
-- payments_external_approval_no_idx 는 external_approval_no(타 소유)용 → 유지

ALTER TABLE public.payments
  DROP COLUMN IF EXISTS external_trxid,
  DROP COLUMN IF EXISTS external_status,
  DROP COLUMN IF EXISTS external_root_trxid,
  DROP COLUMN IF EXISTS reconciled_at;
