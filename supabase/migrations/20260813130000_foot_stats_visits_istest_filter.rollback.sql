-- ============================================================
-- ROLLBACK — T-20260812-foot-TESTDATA-PRE0713-ISTEST-BACKFILL STEP2
-- v_daily_visits / v_daily_visit_rate 를 is_test 필터 추가 直前(LIVE prod 2026-08-13) 정의로 역전.
-- 즉시 역전 가능(출력 시그니처 불변). reloptions/GRANT 무변경 유지.
-- ============================================================

BEGIN;

-- ─── v_daily_visits : is_test 필터 이전(무조인) 정의 복원 ──────────────────────────
CREATE OR REPLACE VIEW public.v_daily_visits AS
SELECT
  (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
  ci.clinic_id,
  COUNT(*)::int AS visit_count,
  SUM(CASE WHEN ci.visit_type = 'new'        THEN 1 ELSE 0 END)::int AS new_count,
  SUM(CASE WHEN ci.visit_type = 'returning'  THEN 1 ELSE 0 END)::int AS returning_count,
  SUM(CASE WHEN ci.visit_type = 'experience' THEN 1 ELSE 0 END)::int AS experience_count
FROM check_ins ci
WHERE ci.status NOT IN ('cancelled')
  AND ci.checked_in_at IS NOT NULL
GROUP BY 1, 2;

-- ─── v_daily_visit_rate : is_test 필터 이전(무조인) 정의 복원 ──────────────────────
CREATE OR REPLACE VIEW public.v_daily_visit_rate AS
WITH res AS (
  SELECT
    r.reservation_date AS dt,
    r.clinic_id,
    COUNT(*)::int AS total_reservations
  FROM reservations r
  WHERE r.status NOT IN ('cancelled')
  GROUP BY 1, 2
),
ck AS (
  SELECT
    (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
    ci.clinic_id,
    COUNT(*)::int AS checkin_count
  FROM check_ins ci
  WHERE ci.status NOT IN ('cancelled')
    AND ci.checked_in_at IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  COALESCE(r.dt, c.dt) AS dt,
  COALESCE(r.clinic_id, c.clinic_id) AS clinic_id,
  COALESCE(r.total_reservations, 0) AS total_reservations,
  COALESCE(c.checkin_count, 0) AS checkin_count,
  CASE
    WHEN COALESCE(r.total_reservations, 0) > 0
    THEN ROUND( (COALESCE(c.checkin_count, 0)::numeric / r.total_reservations) * 100, 1)
    ELSE 0
  END AS visit_rate_pct
FROM res r
FULL OUTER JOIN ck c ON c.dt = r.dt AND c.clinic_id = r.clinic_id;

COMMENT ON VIEW public.v_daily_visits     IS 'foot-047: 일자별 체크인 수 (cancelled 제외)';
COMMENT ON VIEW public.v_daily_visit_rate IS 'foot-047: 내원율 (% = checkin/reservation × 100)';

COMMIT;

NOTIFY pgrst, 'reload schema';
