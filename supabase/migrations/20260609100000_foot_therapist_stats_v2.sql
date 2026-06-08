-- T-20260607-foot-THERAPIST-STATS-V2 — 치료사 통계 로직 재설계 (코어 AC1~AC6)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-06-09
-- 롤백: 20260609100000_foot_therapist_stats_v2.rollback.sql
--
-- ⚠️ db_change = FALSE — 스키마 변경 0건. RPC(CREATE OR REPLACE) 3종만.
--   그라운딩 결론(AC3): 이벤트 순서 무관 매칭에 별도 staging 테이블 불필요.
--   두 이벤트가 이미 영속 테이블에 각각 저장되어 있으므로 "staging"은 쿼리 시점 JOIN 으로 충족.
--     · 이벤트 A (레이저실 이동) = status_transitions.to_status='laser' (check_in_id·transitioned_at·clinic_id 보유)
--     · 이벤트 B (티켓 차감+시술분류) = package_sessions.status='used' (package_id→customers, session_type=분류, session_date, performed_by=치료사)
--   linked = A·B 가 동일 (customer_id ∩ KST date ∩ therapist) 로 JOIN 성립 시. 단독 = pending(집계 제외).
--   당일 미매칭 carry-over 없음 = 동일 KST date INNER JOIN(기간 내).
--
--   ⚠ 매칭 키 정밀도 한계(planner FOLLOWUP 보고): package_sessions 는 차감 시 check_in_id 를 기록하지
--   않으며(3개 insert 사이트 전부 누락) customer_id 직접 컬럼도 없음(package_id→packages→customers 경유).
--   따라서 슬롯-세션 단위 정확 매칭 불가 → (고객+KST일자+치료사) 단위 근사. 동일고객 당일 단일내원·단일차감
--   (정상 케이스)은 정확, 당일 복수내원/복수차감은 근사. 정밀화는 차감 시 check_in_id 기록(별도 코드티켓) 필요.
--
-- AC1 (시술 분류 SSOT): 4종 [비가열/가열/포돌로게/Re:Born]. 수액(iv)·체험(trial) 제외.
--   프리컨디셔닝(preconditioning) 입력 = 비가열 범주로 매핑.
-- AC2 (측정 구간): 시작 = 최초 preconditioning 진입(치료실 슬롯 이동), 종료 = 최초 laser 진입(레이저실 슬롯 이동 직전).
--   기존 v1 의 시작조건 'preconditioning OR laser' → laser 제거(R2). 종료조건 'done' → 'laser 진입 시각' 으로 재정의.
-- AC3 (이벤트 순서 무관 매칭): 위 그라운딩. linked 만 시간 집계.
-- AC4 (시술별 평균 소요시간 + 분포): 치료사 × 4종. cnt=차감건수(B 전체), avg_minutes=linked 만.
-- AC5 (지정치료사): '지정 여부' 입력 필드 부재 확인 — 본 마이그 미포함(placeholder 유지, FOLLOWUP).
-- AC6 (권한·필터): SECURITY INVOKER + RLS(is_approved_user). clinic_id·기간 필수.
--
-- 보안: SECURITY INVOKER. authenticated 만. anon 차단.

BEGIN;

-- 성능 보강(비파괴 additive, 이미 v1 에서 생성됐을 수 있음).
CREATE INDEX IF NOT EXISTS idx_status_transitions_checkin_tostatus
  ON status_transitions (check_in_id, to_status, transitioned_at);
CREATE INDEX IF NOT EXISTS idx_package_sessions_performed_status
  ON package_sessions (performed_by, status, session_date);

-- ─── 1) foot_stats_therapist_summary (재설계) ───────────────────────────────
-- 치료사별 평균 치료시간(linked·AC2 구간) + 체험→결제 전환율(지표4, AC7 트랙 — 기존 유지).
CREATE OR REPLACE FUNCTION foot_stats_therapist_summary(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  therapist_id          UUID,
  name                  TEXT,
  treatment_count       INT,     -- linked 세션 수(시간 산출 가능)
  avg_treatment_minutes NUMERIC, -- 평균 치료시간(분, 소수1). 데이터 없으면 NULL
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
  -- 이벤트 A: AC2 측정구간(시작=preconditioning 진입, 종료=laser 진입). 둘 다 있고 종료>시작.
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
  -- 이벤트 B: 4종 차감(수액·체험 제외). 치료사 = performed_by.
  b_events AS (
    SELECT ps.performed_by AS therapist_id, c.id AS customer_id, ps.session_date AS kst_date
    FROM package_sessions ps
    JOIN packages   pk ON pk.id = ps.package_id
    JOIN customers  c  ON c.id  = pk.customer_id
    WHERE ps.status = 'used'
      AND ps.performed_by IS NOT NULL
      AND c.clinic_id = p_clinic_id
      AND ps.session_date BETWEEN p_from AND p_to
      AND ps.session_type IN ('unheated_laser','preconditioning','heated_laser','podologue','reborn')
  ),
  -- linked: A·B 매칭(고객+KST일자+치료사). check_in 단위로 중복 제거(B 복수 차감 시 시간 중복 방지).
  linked AS (
    SELECT DISTINCT a.check_in_id, a.therapist_id, a.minutes
    FROM a_events a
    WHERE EXISTS (
      SELECT 1 FROM b_events b
      WHERE b.customer_id = a.customer_id
        AND b.therapist_id = a.therapist_id
        AND b.kst_date = a.kst_date
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

-- ─── 2) foot_stats_therapist_services (재설계: AC1/AC4 4종 분포 + 시술별 평균시간) ──
-- 기존 v1: 자유텍스트 service_name 별 건수. → 4종 분류(treatment_type) 기준.
-- cnt = 차감건수(B 전체, AC4 분포). avg_minutes = linked 만(AC4 시술별 평균소요시간, NULL 가능).
-- ⚠ 반환 컬럼(service_name→treatment_type 등) 변경 → CREATE OR REPLACE 불가, DROP 선행 필수.
DROP FUNCTION IF EXISTS foot_stats_therapist_services(UUID, DATE, DATE);
CREATE FUNCTION foot_stats_therapist_services(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  therapist_id   UUID,
  name           TEXT,
  treatment_type TEXT,     -- 4종 [비가열/가열/포돌로게/Re:Born]
  cnt            INT,      -- 차감 건수(분포)
  linked_count   INT,      -- 시간 산출된 매칭 건수
  avg_minutes    NUMERIC   -- 시술별 평균 소요시간(분, 소수1). 매칭 없으면 NULL
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
      CASE ps.session_type
        WHEN 'unheated_laser'  THEN '비가열'
        WHEN 'preconditioning' THEN '비가열'   -- AC1: 프리컨디셔닝 = 비가열 범주
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
  -- 분포: 차감 건수 (B 전체)
  dist AS (
    SELECT therapist_id, treatment_type, COUNT(*)::int AS cnt
    FROM cat
    GROUP BY therapist_id, treatment_type
  ),
  -- linked 시간: check_in × treatment_type 단위(중복 제거 후 평균)
  linked AS (
    SELECT DISTINCT a.check_in_id, a.therapist_id, cat.treatment_type, a.minutes
    FROM a_events a
    JOIN cat ON cat.customer_id = a.customer_id
            AND cat.therapist_id = a.therapist_id
            AND cat.kst_date = a.kst_date
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
  IS 'foot-stats v2: 치료사 평균 치료시간(linked·precond→laser) + 체험전환율. T-20260607-foot-THERAPIST-STATS-V2';
COMMENT ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE)
  IS 'foot-stats v2: 치료사 × 4종 분포 + 시술별 평균 소요시간(linked). T-20260607-foot-THERAPIST-STATS-V2';

COMMIT;
