-- ============================================================
-- ROLLBACK — T-20260813-foot-STATS-REVENUE-ISTEST-FILTER-4SURFACE
--   4 surface 를 is_test 필터 이전(LIVE 2026-08-13 실조회) 정의로 CREATE OR REPLACE 복원.
--   즉시 역전(DROP 0·시그니처 불변). 데이터 무변경이므로 데이터 복원 불요.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm / prod)
-- ============================================================

BEGIN;

-- ─── #1 foot_stats_revenue (RPC) : is_simulation NOT EXISTS 만(is_test 제거) 복원 ──────
CREATE OR REPLACE FUNCTION public.foot_stats_revenue(p_clinic_id uuid, p_from date, p_to date)
 RETURNS TABLE(dt date, package_amount bigint, single_amount bigint, refund_amount bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH single AS (
    SELECT
      accounting_date AS dt,
      SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE 0 END)::bigint AS pay_amt,
      SUM(CASE WHEN payment_type = 'refund'  THEN amount ELSE 0 END)::bigint AS ref_amt
    FROM payments
    WHERE clinic_id = p_clinic_id
      AND accounting_date BETWEEN p_from AND p_to
      AND status NOT IN ('cancelled', 'deleted')
      AND NOT EXISTS (
        SELECT 1 FROM customers c
        WHERE c.id = payments.customer_id
          AND c.is_simulation IS TRUE
      )
    GROUP BY 1
  ),
  pkg AS (
    SELECT
      accounting_date AS dt,
      SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE 0 END)::bigint AS pay_amt,
      SUM(CASE WHEN payment_type = 'refund'  THEN amount ELSE 0 END)::bigint AS ref_amt
    FROM package_payments
    WHERE clinic_id = p_clinic_id
      AND accounting_date BETWEEN p_from AND p_to
      AND NOT EXISTS (
        SELECT 1 FROM customers c
        WHERE c.id = package_payments.customer_id
          AND c.is_simulation IS TRUE
      )
    GROUP BY 1
  )
  SELECT
    COALESCE(s.dt, p.dt)                              AS dt,
    COALESCE(p.pay_amt, 0)                            AS package_amount,
    COALESCE(s.pay_amt, 0)                            AS single_amount,
    COALESCE(s.ref_amt, 0) + COALESCE(p.ref_amt, 0)   AS refund_amount
  FROM single s
  FULL OUTER JOIN pkg p ON p.dt = s.dt
  ORDER BY 1;
$function$;

-- ─── #2 v_daily_avg_spend : customers 미조인(무필터) 복원 ─────────────────────────────
CREATE OR REPLACE VIEW public.v_daily_avg_spend AS
 WITH single AS (
         SELECT (payments.created_at AT TIME ZONE 'Asia/Seoul'::text)::date AS dt,
            payments.clinic_id,
            sum(
                CASE
                    WHEN payments.payment_type = 'refund'::text THEN - payments.amount
                    ELSE payments.amount
                END) AS amt,
            count(*)::integer AS cnt
           FROM payments
          WHERE payments.clinic_id IS NOT NULL
          GROUP BY ((payments.created_at AT TIME ZONE 'Asia/Seoul'::text)::date), payments.clinic_id
        ), pkg AS (
         SELECT (package_payments.created_at AT TIME ZONE 'Asia/Seoul'::text)::date AS dt,
            package_payments.clinic_id,
            sum(
                CASE
                    WHEN package_payments.payment_type = 'refund'::text THEN - package_payments.amount
                    ELSE package_payments.amount
                END) AS amt,
            count(*)::integer AS cnt
           FROM package_payments
          WHERE package_payments.clinic_id IS NOT NULL
          GROUP BY ((package_payments.created_at AT TIME ZONE 'Asia/Seoul'::text)::date), package_payments.clinic_id
        )
 SELECT COALESCE(s.dt, p.dt) AS dt,
    COALESCE(s.clinic_id, p.clinic_id) AS clinic_id,
    COALESCE(s.amt, 0::bigint) + COALESCE(p.amt, 0::bigint) AS net_revenue,
    COALESCE(s.cnt, 0) + COALESCE(p.cnt, 0) AS paid_count,
        CASE
            WHEN (COALESCE(s.cnt, 0) + COALESCE(p.cnt, 0)) > 0 THEN round((COALESCE(s.amt, 0::bigint) + COALESCE(p.amt, 0::bigint))::numeric / (COALESCE(s.cnt, 0) + COALESCE(p.cnt, 0))::numeric, 0)::bigint
            ELSE 0::bigint
        END AS avg_spend
   FROM single s
     FULL JOIN pkg p ON p.dt = s.dt AND p.clinic_id = s.clinic_id;

-- ─── #3 v_monthly_therapist_perf : customers 미조인(무필터) 복원 ──────────────────────
CREATE OR REPLACE VIEW public.v_monthly_therapist_perf AS
 WITH ci_staff AS (
         SELECT ci.id,
            ci.clinic_id,
            ci.checked_in_at,
            ci.completed_at,
            ci.therapist_id AS staff_id,
            'therapist'::text AS staff_role
           FROM check_ins ci
          WHERE ci.therapist_id IS NOT NULL AND ci.status = 'done'::text
        UNION ALL
         SELECT ci.id,
            ci.clinic_id,
            ci.checked_in_at,
            ci.completed_at,
            ci.technician_id AS staff_id,
            'technician'::text AS staff_role
           FROM check_ins ci
          WHERE ci.technician_id IS NOT NULL AND ci.status = 'done'::text
        ), revenue AS (
         SELECT cs.staff_id,
            cs.clinic_id,
            date_trunc('month'::text, (cs.checked_in_at AT TIME ZONE 'Asia/Seoul'::text))::date AS month,
            sum(COALESCE(p.amount_signed, 0::bigint))::bigint AS rev
           FROM ci_staff cs
             LEFT JOIN LATERAL ( SELECT sum(
                        CASE
                            WHEN payments.payment_type = 'refund'::text THEN - payments.amount
                            ELSE payments.amount
                        END) AS amount_signed
                   FROM payments
                  WHERE payments.check_in_id = cs.id) p ON true
          GROUP BY cs.staff_id, cs.clinic_id, (date_trunc('month'::text, (cs.checked_in_at AT TIME ZONE 'Asia/Seoul'::text))::date)
        ), counts AS (
         SELECT cs.staff_id,
            cs.clinic_id,
            date_trunc('month'::text, (cs.checked_in_at AT TIME ZONE 'Asia/Seoul'::text))::date AS month,
            count(*)::integer AS procedure_count,
            avg(EXTRACT(epoch FROM cs.completed_at - cs.checked_in_at) / 60.0) AS avg_stay_min_raw
           FROM ci_staff cs
          WHERE cs.completed_at IS NOT NULL AND cs.completed_at > cs.checked_in_at
          GROUP BY cs.staff_id, cs.clinic_id, (date_trunc('month'::text, (cs.checked_in_at AT TIME ZONE 'Asia/Seoul'::text))::date)
        )
 SELECT c.month,
    c.clinic_id,
    c.staff_id AS technician_id,
    s.name AS technician_name,
    s.role AS technician_role,
    c.procedure_count,
    COALESCE(r.rev, 0::bigint) AS net_revenue,
    round(COALESCE(c.avg_stay_min_raw, 0::numeric), 1) AS avg_stay_min
   FROM counts c
     LEFT JOIN revenue r ON r.staff_id = c.staff_id AND r.clinic_id = c.clinic_id AND r.month = c.month
     LEFT JOIN staff s ON s.id = c.staff_id;

-- ─── #4 v_monthly_consultant_perf : customers 미조인(무필터) 복원 ─────────────────────
CREATE OR REPLACE VIEW public.v_monthly_consultant_perf AS
 WITH ci AS (
         SELECT check_ins.id,
            check_ins.clinic_id,
            check_ins.consultant_id,
            date_trunc('month'::text, (check_ins.checked_in_at AT TIME ZONE 'Asia/Seoul'::text))::date AS month
           FROM check_ins
          WHERE check_ins.consultant_id IS NOT NULL AND check_ins.status = 'done'::text
        ), revenue AS (
         SELECT ci.consultant_id,
            ci.clinic_id,
            ci.month,
            sum(COALESCE(p.amount_signed, 0::bigint))::bigint AS rev
           FROM ci
             LEFT JOIN LATERAL ( SELECT sum(
                        CASE
                            WHEN payments.payment_type = 'refund'::text THEN - payments.amount
                            ELSE payments.amount
                        END) AS amount_signed
                   FROM payments
                  WHERE payments.check_in_id = ci.id) p ON true
          GROUP BY ci.consultant_id, ci.clinic_id, ci.month
        ), counts AS (
         SELECT ci.consultant_id,
            ci.clinic_id,
            ci.month,
            count(*)::integer AS consult_count
           FROM ci
          GROUP BY ci.consultant_id, ci.clinic_id, ci.month
        )
 SELECT c.month,
    c.clinic_id,
    c.consultant_id,
    s.name AS consultant_name,
    c.consult_count,
    COALESCE(r.rev, 0::bigint) AS net_revenue,
        CASE
            WHEN c.consult_count > 0 THEN round(COALESCE(r.rev, 0::bigint)::numeric / c.consult_count::numeric, 0)::bigint
            ELSE 0::bigint
        END AS avg_spend
   FROM counts c
     LEFT JOIN revenue r ON r.consultant_id = c.consultant_id AND r.clinic_id = c.clinic_id AND r.month = c.month
     LEFT JOIN staff s ON s.id = c.consultant_id;

COMMIT;

NOTIFY pgrst, 'reload schema';
