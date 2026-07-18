-- ROLLBACK — T-20260718-foot-VDAILYREV-UNFILTERED-XCRM-APPLY (scalp2 canonical fan-out)
-- 원 v_daily_revenue 복원: 무필터 + security_invoker 미설정 + anon 기본 GRANT 복원.
-- ============================================================================
-- ⚠️ 보안 회귀 경고: 이 롤백은 (1) 취소/삭제 결제 매출부풀림(delta +44,800), (2) anon 공개키
--    REST 매출유출(HTTP200 실증)을 다시 개방한다. 긴급 회귀시에만, 근본원인 별도조치와 pair 로만 실행.
-- ============================================================================
BEGIN;

CREATE OR REPLACE VIEW public.v_daily_revenue AS
WITH single AS (
  SELECT
    (created_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
    clinic_id,
    SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END)::bigint AS amt
  FROM payments
  WHERE clinic_id IS NOT NULL
  GROUP BY 1, 2
),
pkg AS (
  SELECT
    (created_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
    clinic_id,
    SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END)::bigint AS amt
  FROM package_payments
  WHERE clinic_id IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  COALESCE(s.dt, p.dt) AS dt,
  COALESCE(s.clinic_id, p.clinic_id) AS clinic_id,
  COALESCE(s.amt, 0) AS single_revenue,
  COALESCE(p.amt, 0) AS package_revenue,
  COALESCE(s.amt, 0) + COALESCE(p.amt, 0) AS net_revenue
FROM single s
FULL OUTER JOIN pkg p ON p.dt = s.dt AND p.clinic_id = s.clinic_id;

-- CREATE OR REPLACE 는 기존 security_invoker 옵션을 유지하므로 명시적으로 RESET.
ALTER VIEW public.v_daily_revenue RESET (security_invoker);

COMMENT ON VIEW public.v_daily_revenue IS 'foot-047: 일 매출 (payments+package_payments, 환불 차감)';

-- 원 anon 기본 grant 복원 (⚠️ 매출유출 재개방).
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_daily_revenue TO anon;

-- 원장에서 이 마이그 제거.
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260718200000';

COMMIT;

NOTIFY pgrst, 'reload schema';
