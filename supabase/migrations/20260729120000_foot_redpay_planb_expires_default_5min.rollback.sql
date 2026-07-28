-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD (TTL 축소 fold)
--   (20260729120000_foot_redpay_planb_expires_default_5min.sql)
-- ══════════════════════════════════════════════════════════════════
-- 역연산: expires_at DEFAULT 를 5 minutes → 10 minutes 로 복원(w5rs 최초 ADDITIVE 값).
--   비파괴 값 조정의 정확한 역연산. 기존 행/타입/CHECK/NOT NULL 무변경.
--   무접촉: payments/redpay_raw_transactions/customers/check_ins/clinics + pending_payment 기타 컬럼.
-- 멱등: SET DEFAULT 절대값 지정 → 재실행 무해.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.pending_payment
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '10 minutes');

COMMENT ON COLUMN public.pending_payment.expires_at IS
  'TTL 만료 예정 시각. app-set = created_at + interval ''10 minutes'' (DEFAULT 는 앱 누락 대비 fallback). '
  '판정: now() >= expires_at → 배치가 status=expired 전이. T-20260727-foot-REDPAY-PLANB-NOWAIT (ADDITIVE).';

COMMIT;
