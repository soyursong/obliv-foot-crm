-- ============================================================
-- T-20260608-foot-TICKET-DEDUCT-SLOT-DATA  (AC1 + AC3)
-- 통계 집계 레이어에서만 (1) 수액(session_type='iv') 미포함, (2) 체험권 비당일 전환 미집계.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-06-08
-- 롤백: 20260608160000_foot_stats_iv_exclude_trial_conversion.rollback.sql
--
-- ★★ AC1 스코프 LOCK (김주연 총괄 3차 재정정, slack ts 1780900697.315059) ★★
--   "항목에서 삭제하라고 한 적 없다. 통계에서만 데이터 안 가져오면 된다."
--   → 차감 항목 선택 UI 4곳(CheckInDetailSheet SessionUseInSheetDialog / CustomerChartPage
--     c22DeductForm / sessionDlgForm / editSessionForm)·마스터데이터·차감 이력 절대 무변경.
--   → 수액(session_type='iv')은 통계 집계 쿼리에서만 미포함. 본 마이그가 그 '1곳'.
--
-- 변경 대상 (CREATE OR REPLACE FUNCTION 2종, additive·비파괴 — 테이블 컬럼 변경 0):
--   AC1) foot_stats_by_category       : pkg_used 회차 집계에서 session_type='iv' 제외
--                                       (= 통계가 수액 데이터를 '가져오는' 유일 지점)
--   AC3) foot_stats_therapist_summary : 체험→결제 전환(exp_conv)을, 패키지 생성일(contract_date)이
--                                       체험 내원일과 동일한 건만 인정 (비당일 전환은 전환율에서 미집계).
--                                       차감 insert/저장 로직·차단/경고 없음(AC3 정책: ⓠ1).
--
-- ⚠️ STATUS: supervisor 마이그 게이트 경유 후 prod 적용 (AC4 treatment_window 마이그와 병행 게이트).
--   risk: RPC 함수 교체(STABLE/SECURITY INVOKER)만 — 테이블·인덱스·행 무변경, 즉시 역전(rollback) 가능.
-- ============================================================

BEGIN;

-- ─── AC1) foot_stats_by_category : 회차 소진 집계에서 수액(iv) 제외 ─────────────
-- 변경점: pkg_used CTE WHERE 절에 `AND ps.session_type <> 'iv'` 1줄 추가.
-- 그 외 시그니처·반환형·단건(single_paid) 경로·정렬 모두 기존과 동일.
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
      AND ps.session_type <> 'iv'
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

-- ─── AC3) foot_stats_therapist_summary : 전환율은 '당일 전환'만 인정 ────────────
-- 변경점: base 에 visit_date(체험 내원일, Asia/Seoul) 추가, exp_agg 의 전환(exp_conv)
--         FILTER 에 `pk.contract_date = b.visit_date` 조건 추가.
--         exp_total(체험 내원 건수=분모)·차단/경고 없음(정상 차감 허용)은 그대로 유지.
-- 그 외 지표1(평균 치료시간) durations 로직 전부 기존과 동일.
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
  conversion_rate       NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      ci.id,
      ci.therapist_id,
      ci.visit_type,
      ci.package_id,
      (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS visit_date
    FROM check_ins ci
    WHERE ci.clinic_id = p_clinic_id
      AND ci.therapist_id IS NOT NULL
      AND ci.status <> 'cancelled'
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
  ),
  therapists AS (
    SELECT DISTINCT therapist_id FROM base
  ),
  durations AS (
    SELECT
      b.id,
      b.therapist_id,
      EXTRACT(EPOCH FROM (
        MAX(st.transitioned_at) FILTER (WHERE st.to_status = 'done')
        - MIN(st.transitioned_at) FILTER (WHERE st.to_status IN ('preconditioning','laser'))
      )) / 60.0 AS minutes
    FROM base b
    JOIN status_transitions st ON st.check_in_id = b.id
    GROUP BY b.id, b.therapist_id
    HAVING MAX(st.transitioned_at) FILTER (WHERE st.to_status = 'done') IS NOT NULL
       AND MIN(st.transitioned_at) FILTER (WHERE st.to_status IN ('preconditioning','laser')) IS NOT NULL
  ),
  dur_agg AS (
    SELECT
      therapist_id,
      COUNT(*) FILTER (WHERE minutes > 0)::int AS tcount,
      AVG(minutes) FILTER (WHERE minutes > 0)  AS avg_min
    FROM durations
    GROUP BY therapist_id
  ),
  exp_agg AS (
    SELECT
      b.therapist_id,
      COUNT(*)::int AS exp_total,
      -- T-20260608 AC3: 체험권은 '당일 전환'만 인정 — 패키지 생성일(contract_date)이
      -- 체험 내원일(visit_date)과 동일한 건만 전환으로 집계. 비당일 결제는 전환율에서 미집계.
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1
        FROM package_payments pp
        JOIN packages pk ON pk.id = pp.package_id
        WHERE pp.package_id = b.package_id
          AND pp.payment_type = 'payment'
          AND pk.contract_date = b.visit_date
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
$$;

-- 권한 재확인 (CREATE OR REPLACE 는 기존 GRANT 유지하나 멱등 보강)
REVOKE ALL ON FUNCTION foot_stats_by_category(UUID, DATE, DATE)        FROM PUBLIC;
REVOKE ALL ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_by_category(UUID, DATE, DATE)        TO authenticated;
GRANT EXECUTE ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  TO authenticated;

COMMENT ON FUNCTION foot_stats_by_category(UUID, DATE, DATE)
  IS 'foot-stats: 시술 종류별 매출 (회차 소진 + 단건). T-20260430-foot-STATS-DASHBOARD / T-20260608 AC1: iv 통계 제외';
COMMENT ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)
  IS 'foot-stats: 치료사 평균 치료시간 + 체험→결제 전환율(당일 전환만). T-20260607-foot-THERAPIST-STATS / T-20260608 AC3';

COMMIT;
