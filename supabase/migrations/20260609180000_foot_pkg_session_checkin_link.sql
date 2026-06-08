-- T-20260609-foot-PKGSESS-CHECKIN-LINK — 티켓 차감 시 check_in_id 기록 (치료사 통계 정밀화)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-06-09
-- 롤백: 20260609180000_foot_pkg_session_checkin_link.rollback.sql
-- 선행: 20260609100000_foot_therapist_stats_v2.sql (RPC v2 — 본 마이그가 CREATE OR REPLACE 로 정밀화)
--
-- AC1 (스키마): package_sessions.check_in_id (nullable FK→check_ins). ⚠ 컬럼은 initial_schema(2026-04-19)에
--   이미 존재 → 본 마이그의 ADD COLUMN IF NOT EXISTS 는 멱등 no-op(스키마 변경 0). 인덱스만 신규 보강.
--   기존 row 는 NULL 유지(파괴 없음, 근사 fallback 대상).
-- AC2 (기록 로직): FE 차감 사이트(SessionUseInSheetDialog / CustomerChartPage 직접·힐러 차감)에서
--   현재 내원 context 의 check_in_id 를 함께 insert. (코드 변경 — 본 SQL 무관)
-- AC3 (RPC 정밀화): foot_stats_therapist_summary / _services 의 A↔B 매칭을
--   check_in_id 존재 시 정확매칭(check_in_id 동일) 우선, NULL 이면 기존 (고객+KST일자+치료사) 근사 fallback.
--   ※ 치료사 귀속 의미(performed_by == check_in.therapist) 는 v2 와 동일 유지 — 양 브랜치 모두 therapist 일치 요구.
--     정확매칭은 (고객+KST일자) 키를 check_in_id 단일키로 좁혀, 당일 복수내원·복수차감의 교차 오매칭만 차단.
--
-- 보안: SECURITY INVOKER. authenticated 만. anon 차단. (v2 동일)

BEGIN;

-- AC1: 컬럼 멱등 보강(이미 존재 — no-op) + 매칭 성능 인덱스.
ALTER TABLE package_sessions ADD COLUMN IF NOT EXISTS check_in_id UUID REFERENCES check_ins(id);
CREATE INDEX IF NOT EXISTS idx_package_sessions_check_in ON package_sessions (check_in_id);

-- ─── 1) foot_stats_therapist_summary (AC3 정밀화) ───────────────────────────
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
  -- 이벤트 A: AC2 측정구간(시작=preconditioning 진입, 종료=laser 진입).
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
  -- 이벤트 B: 4종 차감(수액·체험 제외). 치료사 = performed_by. check_in_id 보존(정밀화 키).
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
  -- linked: A·B 매칭. check_in_id 있으면 정확매칭, 없으면 (고객+KST일자) 근사. 치료사 일치는 양쪽 공통.
  linked AS (
    SELECT DISTINCT a.check_in_id, a.therapist_id, a.minutes
    FROM a_events a
    WHERE EXISTS (
      SELECT 1 FROM b_events b
      WHERE b.therapist_id = a.therapist_id
        AND (
          -- 정확매칭(차감 시 check_in_id 기록됨): 당일 복수내원 교차 오매칭 차단
          (b.b_check_in_id IS NOT NULL AND b.b_check_in_id = a.check_in_id)
          OR
          -- 근사 fallback(과거/패키지관리 차감 = check_in_id NULL): (고객+KST일자)
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
$$;

-- ─── 2) foot_stats_therapist_services (AC3 정밀화) ──────────────────────────
-- 반환 컬럼은 v2(treatment_type/cnt/linked_count/avg_minutes)와 동일하나, prod 에 v2 미적용(v1 의
-- service_name 기반) 상태일 수 있어 반환타입 충돌 방지를 위해 DROP 선행(멱등). v2 적용 후라도 안전.
DROP FUNCTION IF EXISTS foot_stats_therapist_services(UUID, DATE, DATE);
CREATE FUNCTION foot_stats_therapist_services(
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
  -- linked 시간: check_in × treatment_type. check_in_id 정확매칭 우선, NULL 시 (고객+KST일자) 근사.
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
$$;

REVOKE ALL ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  FROM PUBLIC;
REVOKE ALL ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  TO authenticated;
GRANT EXECUTE ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)
  IS 'foot-stats v2.1: 치료사 평균 치료시간(linked) + 체험전환율. A↔B check_in_id 정확매칭+근사 fallback. T-20260609-foot-PKGSESS-CHECKIN-LINK';
COMMENT ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE)
  IS 'foot-stats v2.1: 치료사 × 4종 분포 + 시술별 평균 소요시간(linked). check_in_id 정확매칭+근사 fallback. T-20260609-foot-PKGSESS-CHECKIN-LINK';

COMMIT;
