-- ============================================================
-- T-20260813-foot-STATS-REVENUE-ISTEST-FILTER-4SURFACE
--   매출·통계 surface 4종에 테스트고객(is_test) 제외 필터 추가 (ADDITIVE)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase / prod)
-- 작성: dev-foot / 2026-08-13
-- 롤백: 20260813150000_foot_stats_revenue_istest_filter_4surface.rollback.sql
-- 부모: T-20260812-foot-TESTDATA-PRE0713-ISTEST-BACKFILL (215 is_test 백필 · v_daily_visits/rate 필터)
--       본건 = 그 매출/통계 완결 leg (부모 범위밖 4 surface, dev-foot STEP1 LIVE 전수조사 발견).
-- 게이트: ★supervisor DDL-diff + DB-GATE GO-token 선행 필수. GO-token 前 prod apply 금지(apply_before_go).
--         순서 권장 = 부모 215 백필 apply 後(테스트고객 is_test=true 실재해야 필터 효과 발현).
--
-- ─── 무엇을 바꾸나 (변경의 전부 = 4 surface 에 테스트고객 제외 필터 추가) ────────────
--   #1 foot_stats_revenue (RPC)      : is_simulation NOT EXISTS 만 → is_test 동반 추가
--   #2 v_daily_avg_spend (VIEW)      : customers 미조인 → LEFT JOIN + is_test·is_simulation 양축 추가
--   #3 v_monthly_therapist_perf(VIEW): check_ins.customer_id 경유 customers 조인 + 양축 추가
--   #4 v_monthly_consultant_perf(VW) : check_ins.customer_id 경유 customers 조인 + 양축 추가
--
-- ─── canonical 패턴 (LIVE prod v_daily_revenue 미러) ───────────────────────────────
--   v_daily_revenue(LIVE) = money LEFT JOIN customers ON customer_id
--     WHERE ... AND NOT COALESCE(c.is_test,false) AND NOT COALESCE(c.is_simulation,false)
--   RPC(#1)는 기존 NOT EXISTS 스타일 유지(최소 diff) → is_test 조건만 OR 추가.
--
-- ─── 워크인(customer_id=NULL) 보존 (fail-safe) ────────────────────────────────────
--   VIEW: LEFT JOIN + NOT COALESCE(cu.is_test,false) → customer_id NULL → cu.* NULL
--         → COALESCE(NULL,false)=false → NOT false = true → 행 보존.
--   RPC : NOT EXISTS → customer_id NULL → 매칭 customers 행 없음 → NOT EXISTS true → 보존.
--   INNER JOIN 은 워크인을 조용히 드롭하므로 채택 안 함.
--   LIVE 실측(STEP1): payments 워크인 2행 / package_payments 0행 / check_ins 워크인 1행 — 전부 보존.
--
-- ─── 델타 (READ-ONLY 검증, 2026-08-13 prod / STEP3 delta_verify) ──────────────────
--   [부모 apply 後 예상 하향] pre-0713 test set(=215 백필 대상, is_test=true) 매출분만 감소:
--     payments(단품)         net -2,175,230 (82행)
--     package_payments(패키지) net -18,510,010 (20행)
--     check_ins-grain(#3/#4)  net   -779,490 (173 check_ins)
--   is_simulation net = 0 (모든 surface·현 5건 무매출) → is_simulation 양축 추가 = 안전벨트(델타 0).
--   워크인 net = 0 감소(보존), 실고객(post-0713·비test·비sim) net = 0 감소(무영향).
--   → 하향 정정(집계대상 축소, 순증 0). 데이터 무변경(필터만).
--
-- ─── 안전성 ─────────────────────────────────────────────────────────────────────
--   RPC/VIEW 전부 CREATE OR REPLACE(DROP 0). 시그니처·출력컬럼 불변 → 즉시 역전 가능.
--   RPC 시그니처 불변: foot_stats_revenue(uuid,date,date) RETURNS TABLE(dt,package_amount,single_amount,refund_amount).
--   reloptions/GRANT 무변경(최소 diff). 테이블/데이터 변경 0.
--   change-class = ADDITIVE-grade(집계대상 축소·신규컬럼0·mutation0). DA=zwq7 GO(is_test canonical)·§3.1 대표게이트 면제.
-- ============================================================

BEGIN;

-- ─── #1 foot_stats_revenue (RPC) : is_simulation NOT EXISTS 에 is_test 동반 추가 ──────
--     시그니처·본문 구조 불변, NOT EXISTS 술어에 `OR c.is_test IS TRUE` 만 추가.
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
      AND NOT EXISTS (                                    -- 시뮬·테스트 고객 결제 제외 (워크인 customer_id=NULL 보존)
        SELECT 1 FROM customers c
        WHERE c.id = payments.customer_id
          AND (c.is_simulation IS TRUE OR c.is_test IS TRUE)
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
      AND NOT EXISTS (                                    -- 시뮬·테스트 고객 결제 제외 (package_payments.customer_id 직결)
        SELECT 1 FROM customers c
        WHERE c.id = package_payments.customer_id
          AND (c.is_simulation IS TRUE OR c.is_test IS TRUE)
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

-- ─── #2 v_daily_avg_spend : customers LEFT JOIN + is_test·is_simulation 양축 추가 ─────
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
             LEFT JOIN customers cu ON cu.id = payments.customer_id          -- ★ 테스트고객 조인 (워크인 NULL 보존)
          WHERE payments.clinic_id IS NOT NULL
            AND NOT COALESCE(cu.is_test, false)                              -- ★ 테스트고객 제외
            AND NOT COALESCE(cu.is_simulation, false)                       -- ★ 시뮬고객 제외 (canonical mirror)
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
             LEFT JOIN customers cu ON cu.id = package_payments.customer_id  -- ★ 테스트고객 조인 (워크인 NULL 보존)
          WHERE package_payments.clinic_id IS NOT NULL
            AND NOT COALESCE(cu.is_test, false)                              -- ★ 테스트고객 제외
            AND NOT COALESCE(cu.is_simulation, false)                       -- ★ 시뮬고객 제외 (canonical mirror)
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

-- ─── #3 v_monthly_therapist_perf : check_ins.customer_id 경유 customers 조인 + 양축 ──
--     ci_staff 2 UNION ALL 브랜치(therapist/technician) 각각에 LEFT JOIN customers + 필터.
CREATE OR REPLACE VIEW public.v_monthly_therapist_perf AS
 WITH ci_staff AS (
         SELECT ci.id,
            ci.clinic_id,
            ci.checked_in_at,
            ci.completed_at,
            ci.therapist_id AS staff_id,
            'therapist'::text AS staff_role
           FROM check_ins ci
             LEFT JOIN customers cu ON cu.id = ci.customer_id               -- ★ 테스트고객 조인 (워크인 NULL 보존)
          WHERE ci.therapist_id IS NOT NULL AND ci.status = 'done'::text
            AND NOT COALESCE(cu.is_test, false)                             -- ★ 테스트고객 제외
            AND NOT COALESCE(cu.is_simulation, false)                       -- ★ 시뮬고객 제외 (canonical mirror)
        UNION ALL
         SELECT ci.id,
            ci.clinic_id,
            ci.checked_in_at,
            ci.completed_at,
            ci.technician_id AS staff_id,
            'technician'::text AS staff_role
           FROM check_ins ci
             LEFT JOIN customers cu ON cu.id = ci.customer_id               -- ★ 테스트고객 조인 (워크인 NULL 보존)
          WHERE ci.technician_id IS NOT NULL AND ci.status = 'done'::text
            AND NOT COALESCE(cu.is_test, false)                             -- ★ 테스트고객 제외
            AND NOT COALESCE(cu.is_simulation, false)                       -- ★ 시뮬고객 제외 (canonical mirror)
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

-- ─── #4 v_monthly_consultant_perf : check_ins.customer_id 경유 customers 조인 + 양축 ─
CREATE OR REPLACE VIEW public.v_monthly_consultant_perf AS
 WITH ci AS (
         SELECT check_ins.id,
            check_ins.clinic_id,
            check_ins.consultant_id,
            date_trunc('month'::text, (check_ins.checked_in_at AT TIME ZONE 'Asia/Seoul'::text))::date AS month
           FROM check_ins
             LEFT JOIN customers cu ON cu.id = check_ins.customer_id        -- ★ 테스트고객 조인 (워크인 NULL 보존)
          WHERE check_ins.consultant_id IS NOT NULL AND check_ins.status = 'done'::text
            AND NOT COALESCE(cu.is_test, false)                             -- ★ 테스트고객 제외
            AND NOT COALESCE(cu.is_simulation, false)                       -- ★ 시뮬고객 제외 (canonical mirror)
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
