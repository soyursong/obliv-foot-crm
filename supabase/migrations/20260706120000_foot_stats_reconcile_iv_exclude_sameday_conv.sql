-- ============================================================
-- T-20260608-foot-TICKET-DEDUCT-SLOT-DATA  (reconcile-R5)  AC1 + AC3
-- 단일 reconciling 마이그 — 42P13 stale-migration 해소 + AC1/AC3 통계 재이식.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성: dev-foot / 2026-07-06
-- 롤백: 20260706120000_foot_stats_reconcile_iv_exclude_sameday_conv.rollback.sql
-- 표준: Migration Ledger Reconciliation (DA-20260704-body-MIG-LEDGER-RECONCILE)
--
-- ─── 왜 이 마이그가 생겼나 (42P13 stale-migration) ───────────────────────────────
--   구 마이그 20260608160000_foot_stats_iv_exclude_trial_conversion.sql 은
--   foot_stats_therapist_summary 를 7컬럼 시그니처로 CREATE OR REPLACE 한다.
--   그러나 현행 prod 는 20260609~20260623 후속계보(v2·designated·roster·treatment-exit-window)로
--   이미 10컬럼(designated_count/total_checkin_count/designated_rate 추가) 상태다(OOB 적용, 원장 미기록).
--   ⇒ 구 마이그를 db push/apply 하면 7컬럼으로 반환형 축소 = 42P13(cannot change return type)
--      + 6/9~6/23 후속계보 통째 regress. 그래서 20260608160000 은 .SUPERSEDED 로 격리했다.
--   본 마이그는 **현행 prod prosrc 를 base**로 두 함수를 시그니처 보존 CREATE OR REPLACE 하여
--   AC1/AC3 필터만 body-only 재이식한다 → 42P13 회피, 후속계보 무regress.
--
-- ─── 정본 = prod 실재 (원장·파일선언과의 divergence 정직 수렴) ────────────────────
--   base 근거: prod prosrc 덤프(Management API /database/query, read-only, ref rxlomoozakkjesdqjtvd, 2026-07-06)
--     · foot_stats_by_category       : RETURNS TABLE(category text, sessions bigint, amount bigint), pkg_used 브랜치
--     · foot_stats_therapist_summary : RETURNS TABLE(10컬럼, roster·treatment-exit-window 계보)
--   두 함수 모두 현행 prod prosrc 를 그대로 base 로 사용하고 아래 필터만 추가.
--
-- ─── 무엇을 바꾸나 (변경의 전부 = 2줄 필터) ─────────────────────────────────────
--   AC1) foot_stats_by_category.pkg_used  : WHERE 절에 `AND ps.session_type <> 'iv'` (수액 통계 미포함).
--        ★ AC1 스코프 LOCK(김주연 총괄): "항목에서 삭제하라고 한 적 없다. 통계에서만 안 가져오면 된다."
--          → 차감 항목 선택 UI 4곳·마스터데이터·차감 이력 절대 무변경. 통계 집계 쿼리 1곳만.
--   AC3) foot_stats_therapist_summary.exp_agg : 체험→결제 전환(exp_conv) FILTER 에
--        `JOIN packages pk` + `AND pk.contract_date = b.kst_date` (패키지 생성일 = 체험 내원일 = 당일 전환만).
--        exp_total(분모)·차단/경고 없음(AC3 정책)은 그대로. contract_date 필터가 후속계보에서
--        유실됐던 것을 복원(prod packages.contract_date 커버리지 16/16 = 데이터는 정상, 필터만 부재).
--   그 외 로직(측정창·roster·designated·단건 single_paid·정렬·GRANT)은 prod 그대로 보존.
--
-- ─── 20260619010000(pkg_created) 처리 ──────────────────────────────────────────
--   repo 20260619010000_foot_stats_by_category_pkg_created 는 by_category 를 pkg_used(소진)→
--   pkg_created(생성/판매, CROSS JOIN LATERAL) 로 바꾸는 KPI 귀속단위 변경이며, G1(김주연 총괄
--   confirm, human_pending: MSG-20260619-020826-m4cw) 미충족으로 **prod 미적용·parked** 상태다.
--   본 reconcile 는 point-2 지시대로 **현행 prod base(pkg_used)+iv-exclude** 를 채택(pkg_created 원본 강행 금지).
--   20260619010000 은 .SUPERSEDED 로 격리하여 별도 적용을 차단(별도 적용 금지). pkg_created 가 향후
--   필요하면 G1 confirm 후 신규 timestamp 마이그로 재발행해야 한다(구 timestamp 부활 금지).
--
-- ─── 안전성 ─────────────────────────────────────────────────────────────────────
--   db_change=TRUE(집계 숫자 이동=비즈로직) 이나 테이블 스키마/데이터 변경 0.
--   두 함수 모두 STABLE / SECURITY INVOKER / SET search_path=public — anon 차단, authenticated 만.
--   시그니처 불변 → CREATE OR REPLACE(DROP 불요) → 42P13 불가·즉시 역전(rollback) 가능·비파괴.
-- ============================================================

BEGIN;

-- ─── AC1) foot_stats_by_category (현행 prod base + iv 통계 제외) ─────────────────
CREATE OR REPLACE FUNCTION foot_stats_by_category(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  category  TEXT,
  sessions  BIGINT,
  amount    BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH pkg_used AS (
    -- 패키지 회차 소진: session_type 별 그룹
    -- T-20260608 AC1: 수액(iv)은 통계 미포함 (차감 이력/UI는 보존, 집계에서만 제외)
    SELECT
      ps.session_type AS category,
      COUNT(*)::bigint AS cnt,
      SUM(COALESCE(ps.unit_price, 0) + COALESCE(ps.surcharge, 0))::bigint AS amt
    FROM package_sessions ps
    JOIN packages p ON p.id = ps.package_id
    WHERE p.clinic_id = p_clinic_id
      AND ps.status = 'used'
      AND ps.session_type <> 'iv'          -- AC1: 수액 통계 제외(집계 유일 지점)
      AND ps.session_date BETWEEN p_from AND p_to
    GROUP BY 1
  ),
  single_paid AS (
    -- 단건: payments + check_in_services -> services.category
    SELECT
      COALESCE(svc.category, 'other') AS category,
      COUNT(DISTINCT cis.id)::bigint  AS cnt,
      SUM(CASE WHEN pay.payment_type = 'refund' THEN -pay.amount ELSE pay.amount END)::bigint AS amt
    FROM payments pay
    JOIN check_in_services cis ON cis.check_in_id = pay.check_in_id
    LEFT JOIN services svc      ON svc.id = cis.service_id
    WHERE pay.clinic_id = p_clinic_id
      AND (pay.created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
    GROUP BY 1
  ),
  unioned AS (
    SELECT category, cnt, amt FROM pkg_used
    UNION ALL
    SELECT category, cnt, amt FROM single_paid
  )
  SELECT
    category,
    SUM(cnt)::bigint AS sessions,
    SUM(amt)::bigint AS amount
  FROM unioned
  GROUP BY 1
  HAVING SUM(amt) <> 0 OR SUM(cnt) > 0
  ORDER BY amount DESC NULLS LAST;
$$;

-- ─── AC3) foot_stats_therapist_summary (현행 prod 10컬럼 base + 당일 전환 필터) ──
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
  -- AC3·AC4 단일 소스(LIVE 동일): staff 치료사·재직 명단.
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
    JOIN roster r ON r.therapist_id = ci.therapist_id   -- AC4: 치료사·재직만
    WHERE ci.clinic_id = p_clinic_id
      AND ci.therapist_id IS NOT NULL
      AND ci.status <> 'cancelled'
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
  ),
  -- 이벤트 A: 측정구간. 시작=치료실 진입(to_status='preconditioning'),
  --   ★종료=치료실 퇴실(from_status='preconditioning'인 최초 전이, 목적지 무관).
  a_events AS (
    SELECT
      b.id AS check_in_id, b.therapist_id, b.customer_id, b.kst_date,
      EXTRACT(EPOCH FROM (w.end_at - w.start_at)) / 60.0 AS minutes
    FROM base b
    JOIN LATERAL (
      SELECT
        MIN(st.transitioned_at) FILTER (WHERE st.to_status   = 'preconditioning') AS start_at,
        MIN(st.transitioned_at) FILTER (WHERE st.from_status = 'preconditioning') AS end_at
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
           -- T-20260608 AC3: 체험권은 '당일 전환'만 인정 — 패키지 생성일(contract_date)이
           -- 체험 내원일(kst_date)과 동일한 건만 전환으로 집계. 비당일 결제는 전환율에서 미집계.
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM package_payments pp
             JOIN packages pk ON pk.id = pp.package_id
             WHERE pp.package_id = b.package_id
               AND pp.payment_type = 'payment'
               AND pk.contract_date = b.kst_date
           ))::int AS exp_conv
    FROM base b
    WHERE b.visit_type = 'experience'
    GROUP BY b.therapist_id
  ),
  -- AC2 지정치료사 비율(옵션B, 20260609220000 산식): check_ins.therapist_id == customers.designated_therapist_id.
  desig_agg AS (
    SELECT b.therapist_id,
           COUNT(*)::int AS total_cnt,
           COUNT(*) FILTER (WHERE c.designated_therapist_id = b.therapist_id)::int AS desig_cnt
    FROM base b
    JOIN customers c ON c.id = b.customer_id
    GROUP BY b.therapist_id
  )
  -- AC3: 기준 축 = roster. 모든 지표 동일 명단. 집계 LEFT JOIN(0활동 재직 치료사도 노출).
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

-- 권한 멱등 보강 (CREATE OR REPLACE 는 기존 GRANT 유지)
REVOKE ALL ON FUNCTION foot_stats_by_category(UUID, DATE, DATE)        FROM PUBLIC;
REVOKE ALL ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_by_category(UUID, DATE, DATE)        TO authenticated;
GRANT EXECUTE ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  TO authenticated;

COMMENT ON FUNCTION foot_stats_by_category(UUID, DATE, DATE)
  IS 'foot-stats: 시술 종류별 매출 (회차 소진 pkg_used + 단건). iv 통계 제외(T-20260608 AC1). reconcile-R5(prod base). T-20260608-foot-TICKET-DEDUCT-SLOT-DATA';
COMMENT ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)
  IS 'foot-stats: 평균치료시간(치료실 체류창) + 체험전환율(당일 전환만: contract_date=내원일) + 지정치료사비율(옵션B). roster 단일소스. reconcile-R5(prod 10컬럼 base + AC3 필터복원). T-20260608 AC3 / T-20260623-STATS-TREATMENT-EXIT-WINDOW';

COMMIT;
