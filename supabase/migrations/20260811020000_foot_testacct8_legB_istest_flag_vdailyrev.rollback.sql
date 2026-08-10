-- ROLLBACK — T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg B (is_test flag + v_daily_revenue filter)
-- 완전가역: (C) 뷰를 20260718 base 정의로 복원 → (B) flag 원복(is_test=false) → (A) 컬럼 DROP.
-- ★ DROP COLUMN 은 뷰가 is_test 를 참조하므로 뷰 복원(C) 이후에 실행해야 함(의존성 순서).
--   apply = supervisor GO-token lane (rollback 도 물리 GO-token 대상).

BEGIN;

-- (C) v_daily_revenue = 20260718 base 로 복원 (customers 조인/is_test 필터 제거).
CREATE OR REPLACE VIEW public.v_daily_revenue
  WITH (security_invoker = on) AS
WITH single AS (
  SELECT
    (created_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
    clinic_id,
    SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END)::bigint AS amt
  FROM payments
  WHERE clinic_id IS NOT NULL
    AND status = 'active'
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

REVOKE ALL ON public.v_daily_revenue FROM anon;

COMMENT ON VIEW public.v_daily_revenue IS
  'foot-047 + T-20260718-foot-VDAILYREV-APPLY: 일 매출(payments status=active + package_payments, 환불차감). security_invoker=on, anon REVOKE.';

-- (B) flag 원복 (freeze-set 3 uuid → is_test=false). 뒤이어 컬럼 DROP 이므로 사실상 no-op 이나
--     컬럼만 남기고 flag 만 되돌리는 부분 롤백에도 대응하도록 명시.
UPDATE public.customers
   SET is_test = false
 WHERE id IN (
   '78975d00-9d31-4ac3-848c-0f77c6f0d735'::uuid,
   '351d34c5-2dd9-4583-bfb3-8e27025777a6'::uuid,
   '80df7a6b-077d-46db-b9db-31591f3977a4'::uuid
 );

-- (A) 컬럼 DROP (완전가역). IF EXISTS = 멱등.
ALTER TABLE public.customers DROP COLUMN IF EXISTS is_test;

COMMIT;

NOTIFY pgrst, 'reload schema';
