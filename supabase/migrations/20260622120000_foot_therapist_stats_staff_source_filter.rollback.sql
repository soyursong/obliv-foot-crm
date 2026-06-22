-- ROLLBACK — T-20260622-foot-STATS-THERAPIST-LOAD-STAFFFILTER
-- 적용 직전 LIVE 정의(7컬럼 summary / 6컬럼 services, laser-end 측정창, check_in_id 정밀매칭)를
-- pg_get_functiondef 로 그대로 캡처해 복원. roster 필터/anchor 도입 이전 상태로 100% 환원.
-- DB: rxlomoozakkjesdqjtvd. 반환형 무변경 → CREATE OR REPLACE.

BEGIN;

CREATE OR REPLACE FUNCTION public.foot_stats_therapist_summary(p_clinic_id uuid, p_from date, p_to date)
 RETURNS TABLE(therapist_id uuid, name text, treatment_count integer, avg_treatment_minutes numeric, experience_total integer, experience_converted integer, conversion_rate numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT ci.id, ci.therapist_id, ci.customer_id, ci.visit_type, ci.package_id,
           (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date
    FROM check_ins ci
    WHERE ci.clinic_id = p_clinic_id
      AND ci.therapist_id IS NOT NULL
      AND ci.status <> 'cancelled'
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
  ),
  therapists AS (
    SELECT DISTINCT therapist_id FROM base
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
  )
  SELECT
    s.id                                                   AS therapist_id,
    s.name                                                 AS name,
    COALESCE(d.tcount, 0)                                  AS treatment_count,
    CASE WHEN d.avg_min IS NOT NULL THEN ROUND(d.avg_min, 1) END AS avg_treatment_minutes,
    COALESCE(e.exp_total, 0)                               AS experience_total,
    COALESCE(e.exp_conv, 0)                                AS experience_converted,
    CASE WHEN COALESCE(e.exp_total, 0) > 0
      THEN ROUND(e.exp_conv::numeric / e.exp_total * 100, 1)
    END                                                    AS conversion_rate
  FROM therapists t
  JOIN staff s        ON s.id = t.therapist_id
  LEFT JOIN dur_agg d ON d.therapist_id = t.therapist_id
  LEFT JOIN exp_agg e ON e.therapist_id = t.therapist_id
  WHERE s.clinic_id = p_clinic_id
  ORDER BY avg_treatment_minutes DESC NULLS LAST, s.name;
$function$;

CREATE OR REPLACE FUNCTION public.foot_stats_therapist_services(p_clinic_id uuid, p_from date, p_to date)
 RETURNS TABLE(therapist_id uuid, name text, treatment_type text, cnt integer, linked_count integer, avg_minutes numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH cat AS (
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
    d.therapist_id,
    s.name,
    d.treatment_type,
    d.cnt,
    COALESCE(ta.linked_count, 0) AS linked_count,
    CASE WHEN ta.avg_min IS NOT NULL THEN ROUND(ta.avg_min, 1) END AS avg_minutes
  FROM dist d
  JOIN staff s ON s.id = d.therapist_id AND s.clinic_id = p_clinic_id
  LEFT JOIN time_agg ta
    ON ta.therapist_id = d.therapist_id AND ta.treatment_type = d.treatment_type
  ORDER BY s.name, d.cnt DESC;
$function$;

REVOKE ALL ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  FROM PUBLIC;
REVOKE ALL ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  TO authenticated;
GRANT EXECUTE ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE) TO authenticated;

COMMIT;
