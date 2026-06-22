-- ROLLBACK: T-20260623-foot-STATS-TREATMENT-EXIT-WINDOW
-- 측정창 종료기준을 적용 직전 LIVE 정의(laser-end)로 복원.
--   · summary  = 20260623120000(roster·designated 10컬럼) end_at = to_status='laser'.
--   · services = 20260622120000(roster×4종 grid 6컬럼) end_at = to_status='laser'.
-- additive 인덱스(idx_status_transitions_checkin_fromstatus)는 비파괴라 유지(DROP 불필요/무영향).
--   완전 원복 원하면 끝의 DROP INDEX 주석 해제.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)

BEGIN;

-- ─── 1) foot_stats_therapist_summary 복원 (20260623120000 = laser-end) ──
CREATE OR REPLACE FUNCTION foot_stats_therapist_summary(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  therapist_id          UUID,
  name                  TEXT,
  treatment_count       INT,
  avg_treatment_minutes NUMERIC,
  experience_total      INT,
  experience_converted  INT,
  conversion_rate       NUMERIC,
  designated_count      INT,
  total_checkin_count   INT,
  designated_rate       NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  roster AS (
    SELECT s.id AS therapist_id, s.name
    FROM staff s
    WHERE s.clinic_id = p_clinic_id
      AND s.role = 'therapist'
      AND s.active = true
  ),
  base AS (
    SELECT ci.id, ci.therapist_id, ci.customer_id, ci.visit_type, ci.package_id,
           (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date
    FROM check_ins ci
    JOIN roster r ON r.therapist_id = ci.therapist_id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.therapist_id IS NOT NULL
      AND ci.status <> 'cancelled'
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
  ),
  a_events AS (
    SELECT
      b.id AS check_in_id, b.therapist_id, b.customer_id, b.kst_date,
      EXTRACT(EPOCH FROM (w.end_at - w.start_at)) / 60.0 AS minutes
    FROM base b
    JOIN LATERAL (
      SELECT
        MIN(st.transitioned_at) FILTER (WHERE st.to_status = 'preconditioning') AS start_at,
        MIN(st.transitioned_at) FILTER (WHERE st.to_status = 'laser')           AS end_at
      FROM status_transitions st
      WHERE st.check_in_id = b.id
    ) w ON TRUE
    WHERE w.start_at IS NOT NULL AND w.end_at IS NOT NULL AND w.end_at > w.start_at
  ),
  b_events AS (
    SELECT ps.performed_by AS therapist_id, c.id AS customer_id, ps.session_date AS kst_date,
           ps.check_in_id AS b_check_in_id
    FROM package_sessions ps
    JOIN packages   pk ON pk.id = ps.package_id
    JOIN customers  c  ON c.id  = pk.customer_id
    JOIN roster     r  ON r.therapist_id = ps.performed_by
    WHERE ps.status = 'used'
      AND ps.performed_by IS NOT NULL
      AND c.clinic_id = p_clinic_id
      AND ps.session_date BETWEEN p_from AND p_to
      AND ps.session_type IN ('unheated_laser','preconditioning','heated_laser','podologue','reborn')
  ),
  linked AS (
    SELECT DISTINCT a.check_in_id, a.therapist_id, a.minutes
    FROM a_events a
    WHERE EXISTS (
      SELECT 1 FROM b_events b
      WHERE b.therapist_id = a.therapist_id
        AND (
          (b.b_check_in_id IS NOT NULL AND b.b_check_in_id = a.check_in_id)
          OR
          (b.b_check_in_id IS NULL
            AND b.customer_id = a.customer_id
            AND b.kst_date   = a.kst_date)
        )
    )
  ),
  dur_agg AS (
    SELECT therapist_id,
           COUNT(*) FILTER (WHERE minutes > 0)::int AS tcount,
           AVG(minutes) FILTER (WHERE minutes > 0)  AS avg_min
    FROM linked
    GROUP BY therapist_id
  ),
  exp_agg AS (
    SELECT b.therapist_id,
           COUNT(*)::int AS exp_total,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM package_payments pp
             WHERE pp.package_id = b.package_id
               AND pp.payment_type = 'payment'
           ))::int AS exp_conv
    FROM base b
    WHERE b.visit_type = 'experience'
    GROUP BY b.therapist_id
  ),
  desig_agg AS (
    SELECT b.therapist_id,
           COUNT(*)::int AS total_cnt,
           COUNT(*) FILTER (WHERE c.designated_therapist_id = b.therapist_id)::int AS desig_cnt
    FROM base b
    JOIN customers c ON c.id = b.customer_id
    GROUP BY b.therapist_id
  )
  SELECT
    r.therapist_id                                         AS therapist_id,
    r.name                                                 AS name,
    COALESCE(d.tcount, 0)                                  AS treatment_count,
    CASE WHEN d.avg_min IS NOT NULL THEN ROUND(d.avg_min, 1) END AS avg_treatment_minutes,
    COALESCE(e.exp_total, 0)                               AS experience_total,
    COALESCE(e.exp_conv, 0)                                AS experience_converted,
    CASE WHEN COALESCE(e.exp_total, 0) > 0
      THEN ROUND(e.exp_conv::numeric / e.exp_total * 100, 1)
    END                                                    AS conversion_rate,
    COALESCE(g.desig_cnt, 0)                               AS designated_count,
    COALESCE(g.total_cnt, 0)                               AS total_checkin_count,
    CASE WHEN COALESCE(g.total_cnt, 0) > 0
      THEN ROUND(g.desig_cnt::numeric / g.total_cnt * 100, 1)
    END                                                    AS designated_rate
  FROM roster r
  LEFT JOIN dur_agg d   ON d.therapist_id = r.therapist_id
  LEFT JOIN exp_agg e   ON e.therapist_id = r.therapist_id
  LEFT JOIN desig_agg g ON g.therapist_id = r.therapist_id
  ORDER BY avg_treatment_minutes DESC NULLS LAST, r.name;
$$;

-- ─── 2) foot_stats_therapist_services 복원 (20260622120000 = laser-end) ──
CREATE OR REPLACE FUNCTION foot_stats_therapist_services(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  therapist_id   UUID,
  name           TEXT,
  treatment_type TEXT,
  cnt            INT,
  linked_count   INT,
  avg_minutes    NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  roster AS (
    SELECT s.id AS therapist_id, s.name
    FROM staff s
    WHERE s.clinic_id = p_clinic_id
      AND s.role = 'therapist'
      AND s.active = true
  ),
  types(treatment_type) AS (
    VALUES ('비가열'), ('가열'), ('포돌로게'), ('Re:Born')
  ),
  grid AS (
    SELECT r.therapist_id, r.name, t.treatment_type
    FROM roster r CROSS JOIN types t
  ),
  cat AS (
    SELECT
      ps.id,
      ps.performed_by AS therapist_id,
      c.id            AS customer_id,
      ps.session_date AS kst_date,
      ps.check_in_id  AS b_check_in_id,
      CASE ps.session_type
        WHEN 'unheated_laser'  THEN '비가열'
        WHEN 'preconditioning' THEN '비가열'
        WHEN 'heated_laser'    THEN '가열'
        WHEN 'podologue'       THEN '포돌로게'
        WHEN 'reborn'          THEN 'Re:Born'
      END AS treatment_type
    FROM package_sessions ps
    JOIN packages  pk ON pk.id = ps.package_id
    JOIN customers c  ON c.id  = pk.customer_id
    JOIN roster    r  ON r.therapist_id = ps.performed_by
    WHERE ps.status = 'used'
      AND ps.performed_by IS NOT NULL
      AND c.clinic_id = p_clinic_id
      AND ps.session_date BETWEEN p_from AND p_to
      AND ps.session_type IN ('unheated_laser','preconditioning','heated_laser','podologue','reborn')
  ),
  base AS (
    SELECT ci.id, ci.therapist_id, ci.customer_id,
           (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date
    FROM check_ins ci
    JOIN roster r ON r.therapist_id = ci.therapist_id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.therapist_id IS NOT NULL
      AND ci.status <> 'cancelled'
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
  ),
  a_events AS (
    SELECT b.id AS check_in_id, b.therapist_id, b.customer_id, b.kst_date,
           EXTRACT(EPOCH FROM (w.end_at - w.start_at)) / 60.0 AS minutes
    FROM base b
    JOIN LATERAL (
      SELECT
        MIN(st.transitioned_at) FILTER (WHERE st.to_status = 'preconditioning') AS start_at,
        MIN(st.transitioned_at) FILTER (WHERE st.to_status = 'laser')           AS end_at
      FROM status_transitions st
      WHERE st.check_in_id = b.id
    ) w ON TRUE
    WHERE w.start_at IS NOT NULL AND w.end_at IS NOT NULL AND w.end_at > w.start_at
  ),
  dist AS (
    SELECT therapist_id, treatment_type, COUNT(*)::int AS cnt
    FROM cat
    GROUP BY therapist_id, treatment_type
  ),
  linked AS (
    SELECT DISTINCT a.check_in_id, a.therapist_id, cat.treatment_type, a.minutes
    FROM a_events a
    JOIN cat ON cat.therapist_id = a.therapist_id
            AND (
              (cat.b_check_in_id IS NOT NULL AND cat.b_check_in_id = a.check_in_id)
              OR
              (cat.b_check_in_id IS NULL
                AND cat.customer_id = a.customer_id
                AND cat.kst_date    = a.kst_date)
            )
  ),
  time_agg AS (
    SELECT therapist_id, treatment_type,
           COUNT(*)::int AS linked_count,
           AVG(minutes) FILTER (WHERE minutes > 0) AS avg_min
    FROM linked
    GROUP BY therapist_id, treatment_type
  )
  SELECT
    g.therapist_id,
    g.name,
    g.treatment_type,
    COALESCE(d.cnt, 0)           AS cnt,
    COALESCE(ta.linked_count, 0) AS linked_count,
    CASE WHEN ta.avg_min IS NOT NULL THEN ROUND(ta.avg_min, 1) END AS avg_minutes
  FROM grid g
  LEFT JOIN dist d
    ON d.therapist_id = g.therapist_id AND d.treatment_type = g.treatment_type
  LEFT JOIN time_agg ta
    ON ta.therapist_id = g.therapist_id AND ta.treatment_type = g.treatment_type
  ORDER BY g.name, cnt DESC;
$$;

REVOKE ALL ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  FROM PUBLIC;
REVOKE ALL ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  TO authenticated;
GRANT EXECUTE ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)
  IS 'foot-stats: 평균치료시간+체험전환율+지정치료사비율(옵션B). 명단 단일소스=staff(치료사·재직) roster. T-20260622-foot-STATS-MIGRATION-DRIFT-2PHANTOM (designated on roster)';
COMMENT ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE)
  IS 'foot-stats: 치료사 × 4종 분포+시술별 평균소요시간. 명단 단일소스=staff(치료사·재직) × 4종 grid. T-20260622-foot-STATS-THERAPIST-LOAD-STAFFFILTER (AC3·AC4)';

-- 완전 원복(인덱스까지) 원하면 아래 주석 해제:
-- DROP INDEX IF EXISTS idx_status_transitions_checkin_fromstatus;

COMMIT;
