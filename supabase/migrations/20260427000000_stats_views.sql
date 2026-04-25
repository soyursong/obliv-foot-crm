-- foot-047: Statistics views for daily trends + monthly staff performance
-- 8 views (6 daily + 2 monthly). All views use SECURITY INVOKER (default) so
-- the underlying tables' RLS (`is_approved_user()`) gates access automatically.
--
-- Conventions:
--   - Date column is `dt DATE` (Asia/Seoul) for daily; `month DATE` (yyyy-mm-01) for monthly.
--   - Money fields are net (payments are signed: +payment, -refund).
--   - Per-clinic rows; client may aggregate across clinics for "all clinics".

-- ─── 1) v_daily_visits ──────────────────────────────────────────────────────
-- 일자별 체크인 수 (no_show, cancelled 제외)
DROP VIEW IF EXISTS v_daily_visits CASCADE;
CREATE VIEW v_daily_visits AS
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

-- ─── 2) v_daily_revenue ─────────────────────────────────────────────────────
-- 일 매출 (단건 + 패키지). 환불은 음수.
DROP VIEW IF EXISTS v_daily_revenue CASCADE;
CREATE VIEW v_daily_revenue AS
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

-- ─── 3) v_daily_consult_wait ───────────────────────────────────────────────
-- 평균 상담 대기시간 (체크인 → consultation 전이 시각, 분 단위)
-- status_transitions 활용. consult_waiting → consultation 전이까지 대기시간.
DROP VIEW IF EXISTS v_daily_consult_wait CASCADE;
CREATE VIEW v_daily_consult_wait AS
WITH starts AS (
  SELECT DISTINCT ON (st.check_in_id)
    st.check_in_id,
    st.clinic_id,
    st.transitioned_at AS consult_started_at
  FROM status_transitions st
  WHERE st.to_status = 'consultation'
  ORDER BY st.check_in_id, st.transitioned_at ASC
)
SELECT
  (s.consult_started_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
  s.clinic_id,
  ROUND(AVG(EXTRACT(EPOCH FROM (s.consult_started_at - ci.checked_in_at)) / 60.0)::numeric, 1) AS avg_wait_min,
  COUNT(*)::int AS sample_count
FROM starts s
JOIN check_ins ci ON ci.id = s.check_in_id
WHERE ci.checked_in_at IS NOT NULL
  AND s.consult_started_at > ci.checked_in_at
GROUP BY 1, 2;

-- ─── 4) v_daily_stay_duration ──────────────────────────────────────────────
-- 평균 체류시간 (체크인 → 완료, 분 단위)
DROP VIEW IF EXISTS v_daily_stay_duration CASCADE;
CREATE VIEW v_daily_stay_duration AS
SELECT
  (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
  ci.clinic_id,
  ROUND(AVG(EXTRACT(EPOCH FROM (ci.completed_at - ci.checked_in_at)) / 60.0)::numeric, 1) AS avg_stay_min,
  COUNT(*)::int AS sample_count
FROM check_ins ci
WHERE ci.status = 'done'
  AND ci.completed_at IS NOT NULL
  AND ci.checked_in_at IS NOT NULL
  AND ci.completed_at > ci.checked_in_at
GROUP BY 1, 2;

-- ─── 5) v_daily_avg_spend ──────────────────────────────────────────────────
-- 평균 객단가 (당일 매출 / 결제건수)
DROP VIEW IF EXISTS v_daily_avg_spend CASCADE;
CREATE VIEW v_daily_avg_spend AS
WITH single AS (
  SELECT
    (created_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
    clinic_id,
    SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END)::bigint AS amt,
    COUNT(*)::int AS cnt
  FROM payments
  WHERE clinic_id IS NOT NULL
  GROUP BY 1, 2
),
pkg AS (
  SELECT
    (created_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
    clinic_id,
    SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END)::bigint AS amt,
    COUNT(*)::int AS cnt
  FROM package_payments
  WHERE clinic_id IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  COALESCE(s.dt, p.dt) AS dt,
  COALESCE(s.clinic_id, p.clinic_id) AS clinic_id,
  COALESCE(s.amt, 0) + COALESCE(p.amt, 0) AS net_revenue,
  COALESCE(s.cnt, 0) + COALESCE(p.cnt, 0) AS paid_count,
  CASE
    WHEN (COALESCE(s.cnt, 0) + COALESCE(p.cnt, 0)) > 0
    THEN ROUND( ( (COALESCE(s.amt, 0) + COALESCE(p.amt, 0)) ::numeric / (COALESCE(s.cnt, 0) + COALESCE(p.cnt, 0)) )::numeric, 0)::bigint
    ELSE 0
  END AS avg_spend
FROM single s
FULL OUTER JOIN pkg p ON p.dt = s.dt AND p.clinic_id = s.clinic_id;

-- ─── 6) v_daily_visit_rate ─────────────────────────────────────────────────
-- 내원율 (체크인 / 예약, 취소·노쇼 제외 분모)
DROP VIEW IF EXISTS v_daily_visit_rate CASCADE;
CREATE VIEW v_daily_visit_rate AS
WITH res AS (
  SELECT
    reservation_date AS dt,
    clinic_id,
    COUNT(*)::int AS total_reservations
  FROM reservations
  WHERE status NOT IN ('cancelled')
  GROUP BY 1, 2
),
ck AS (
  SELECT
    (checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
    clinic_id,
    COUNT(*)::int AS checkin_count
  FROM check_ins
  WHERE status NOT IN ('cancelled')
    AND checked_in_at IS NOT NULL
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

-- ─── 7) v_monthly_therapist_perf ───────────────────────────────────────────
-- 월간 관리사·치료사별 성과 (시술 건수, 매출, 평균 체류시간)
-- therapist_id 또는 technician_id 둘 다 집계 (검색 파편화 방지)
DROP VIEW IF EXISTS v_monthly_therapist_perf CASCADE;
CREATE VIEW v_monthly_therapist_perf AS
WITH ci_staff AS (
  -- check_ins.therapist_id 와 technician_id를 union — 한 행이 두 사람 모두 차지하면 양쪽 카운트
  SELECT
    ci.id, ci.clinic_id, ci.checked_in_at, ci.completed_at, ci.therapist_id AS staff_id, 'therapist' AS staff_role
  FROM check_ins ci
  WHERE ci.therapist_id IS NOT NULL AND ci.status = 'done'
  UNION ALL
  SELECT
    ci.id, ci.clinic_id, ci.checked_in_at, ci.completed_at, ci.technician_id AS staff_id, 'technician' AS staff_role
  FROM check_ins ci
  WHERE ci.technician_id IS NOT NULL AND ci.status = 'done'
),
revenue AS (
  -- 시술자별 매출 = 그 check_in_id의 payments + package_payments(via check_in 패키지)
  SELECT
    cs.staff_id,
    cs.clinic_id,
    DATE_TRUNC('month', (cs.checked_in_at AT TIME ZONE 'Asia/Seoul'))::date AS month,
    SUM(COALESCE(p.amount_signed, 0))::bigint AS rev
  FROM ci_staff cs
  LEFT JOIN LATERAL (
    SELECT SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END) AS amount_signed
    FROM payments
    WHERE check_in_id = cs.id
  ) p ON TRUE
  GROUP BY 1, 2, 3
),
counts AS (
  SELECT
    cs.staff_id,
    cs.clinic_id,
    DATE_TRUNC('month', (cs.checked_in_at AT TIME ZONE 'Asia/Seoul'))::date AS month,
    COUNT(*)::int AS procedure_count,
    AVG(EXTRACT(EPOCH FROM (cs.completed_at - cs.checked_in_at)) / 60.0) AS avg_stay_min_raw
  FROM ci_staff cs
  WHERE cs.completed_at IS NOT NULL AND cs.completed_at > cs.checked_in_at
  GROUP BY 1, 2, 3
)
SELECT
  c.month,
  c.clinic_id,
  c.staff_id AS technician_id,
  s.name AS technician_name,
  s.role AS technician_role,
  c.procedure_count,
  COALESCE(r.rev, 0) AS net_revenue,
  ROUND(COALESCE(c.avg_stay_min_raw, 0)::numeric, 1) AS avg_stay_min
FROM counts c
LEFT JOIN revenue r
  ON r.staff_id = c.staff_id AND r.clinic_id = c.clinic_id AND r.month = c.month
LEFT JOIN staff s ON s.id = c.staff_id;

-- ─── 8) v_monthly_consultant_perf ──────────────────────────────────────────
-- 월간 상담실장별 성과 (상담 건수, 매출, 평균 객단가)
DROP VIEW IF EXISTS v_monthly_consultant_perf CASCADE;
CREATE VIEW v_monthly_consultant_perf AS
WITH ci AS (
  SELECT
    id, clinic_id, consultant_id,
    DATE_TRUNC('month', (checked_in_at AT TIME ZONE 'Asia/Seoul'))::date AS month
  FROM check_ins
  WHERE consultant_id IS NOT NULL
    AND status = 'done'
),
revenue AS (
  SELECT
    ci.consultant_id,
    ci.clinic_id,
    ci.month,
    SUM(COALESCE(p.amount_signed, 0))::bigint AS rev
  FROM ci
  LEFT JOIN LATERAL (
    SELECT SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END) AS amount_signed
    FROM payments
    WHERE check_in_id = ci.id
  ) p ON TRUE
  GROUP BY 1, 2, 3
),
counts AS (
  SELECT
    consultant_id, clinic_id, month,
    COUNT(*)::int AS consult_count
  FROM ci
  GROUP BY 1, 2, 3
)
SELECT
  c.month,
  c.clinic_id,
  c.consultant_id,
  s.name AS consultant_name,
  c.consult_count,
  COALESCE(r.rev, 0) AS net_revenue,
  CASE
    WHEN c.consult_count > 0
    THEN ROUND( (COALESCE(r.rev, 0)::numeric / c.consult_count)::numeric, 0)::bigint
    ELSE 0
  END AS avg_spend
FROM counts c
LEFT JOIN revenue r
  ON r.consultant_id = c.consultant_id AND r.clinic_id = c.clinic_id AND r.month = c.month
LEFT JOIN staff s ON s.id = c.consultant_id;

-- Grant SELECT to authenticated role; RLS on base tables (`is_approved_user()`)
-- gates row visibility automatically because views default to SECURITY INVOKER.
GRANT SELECT ON v_daily_visits          TO authenticated;
GRANT SELECT ON v_daily_revenue         TO authenticated;
GRANT SELECT ON v_daily_consult_wait    TO authenticated;
GRANT SELECT ON v_daily_stay_duration   TO authenticated;
GRANT SELECT ON v_daily_avg_spend       TO authenticated;
GRANT SELECT ON v_daily_visit_rate      TO authenticated;
GRANT SELECT ON v_monthly_therapist_perf  TO authenticated;
GRANT SELECT ON v_monthly_consultant_perf TO authenticated;

COMMENT ON VIEW v_daily_visits        IS 'foot-047: 일자별 체크인 수 (cancelled 제외)';
COMMENT ON VIEW v_daily_revenue       IS 'foot-047: 일 매출 (payments+package_payments, 환불 차감)';
COMMENT ON VIEW v_daily_consult_wait  IS 'foot-047: 평균 상담 대기시간 (분) — checked_in→consultation 첫 전이';
COMMENT ON VIEW v_daily_stay_duration IS 'foot-047: 평균 체류시간 (분) — checked_in→completed';
COMMENT ON VIEW v_daily_avg_spend     IS 'foot-047: 평균 객단가 (일 매출/결제건수)';
COMMENT ON VIEW v_daily_visit_rate    IS 'foot-047: 내원율 (% = checkin/reservation × 100)';
COMMENT ON VIEW v_monthly_therapist_perf  IS 'foot-047: 월간 관리사/치료사별 시술 건수·매출·평균 체류';
COMMENT ON VIEW v_monthly_consultant_perf IS 'foot-047: 월간 상담실장별 상담 건수·매출·평균 객단가';
