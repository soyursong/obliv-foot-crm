-- T-20260622-foot-STATS-THERAPIST-LOAD-STAFFFILTER — AC3·AC4: 치료사 통계 직원 소스 단일화 + 재직 치료사 한정
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성: dev-foot / 2026-06-22
-- 롤백: 20260622120000_foot_therapist_stats_staff_source_filter.rollback.sql (적용 직전 LIVE 정의 그대로 복원)
-- ref: MSG-20260622-105450 (planner NEW-TASK) / 김주연 운영총괄 U0ATDB587PV
--
-- ⚠️ db_change = FALSE — 반환형(컬럼·타입·순서) 무변경. RPC(CREATE OR REPLACE) 2종만. DROP 불요.
--    summary 7컬럼·services 6컬럼 LIVE 시그니처 그대로 유지(아래 드리프트 노트 참조).
--
-- ─── 무엇을 바꾸나 (AC3·AC4, 이 변경의 전부) ────────────────────────────────
--   AC3: 치료사 통계 탭 모든 항목(지표1~4)의 "치료사 명단 출처"를 단일 소스로 통일한다.
--        단일 소스 = 직원·공간 > 직원 화면과 동일한 staff '치료사(role=therapist)·재직(active)' 명단(roster).
--        기존: summary 는 check_ins.therapist_id DISTINCT, services 는 package_sessions.performed_by 에서
--              각각 명단을 파생 → 지표마다 다른 사람 집합 노출(항목별 상이 출처) + 0활동 재직 치료사 누락.
--        정정: 두 RPC 모두 roster 를 기준 축으로 두고 집계를 LEFT JOIN. 모든 지표가 동일 명단 공유.
--   AC4: 집계 대상 = 치료사 role + 재직만. 퇴사자(active=false, 예: 김성우)·비치료사 role
--        (상담실장=consultant 엄경은·김주연 등)·장비(technician) 제외.
--
-- ─── 다른 것은 일절 손대지 않음 (회귀 0 보장) ───────────────────────────────
--   측정창(시작=preconditioning 진입, 종료=laser 진입), check_in_id 정밀매칭+근사 fallback,
--   체험 전환율 산식, IV 제외, 반환 컬럼/순서/타입 — 모두 적용 직전 LIVE 정의와 동일.
--   roster 필터/anchor 외 한 줄도 바꾸지 않는다.
--
-- ─── ⚠️ 착수 중 발견한 마이그 드리프트 (planner/supervisor 참고, 본 티켓 범위 아님) ──
--   LIVE summary 는 7컬럼(designated 3종 없음) + 측정종료 to_status='laser' + check_in_id 정밀매칭.
--   파일로만 존재하고 LIVE 미적용인 마이그(= phantom):
--     · 20260609220000_..._designated_ratio (지표3 10컬럼화)  → 미적용 ∴ FE 지표3 가 현재 빈 값.
--     · 20260612130000_..._treatment_exit   (측정창 치료실퇴실) → 미적용 + 0609180000 정밀매칭 누락(되레 회귀).
--   본 마이그는 LIVE 정의를 베이스로 삼아(0612 파일 베이스 아님) AC3/AC4 만 surgical 추가 → 위 drift 는
--   건드리지 않는다(지표3/측정창 변동 없음). drift 정리는 별도 티켓 권고 — planner FOLLOWUP 통지함.
--
-- 보안: SECURITY INVOKER(LIVE 동일, 명시 SET search_path). authenticated 만. anon 차단.

BEGIN;

-- ─── 1) foot_stats_therapist_summary (LIVE 7컬럼 그대로 + roster anchor/필터) ──
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
  WITH
  -- AC3·AC4 단일 소스: 직원·공간 > 직원 화면과 동일한 staff '치료사·재직' 명단.
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
  -- 이벤트 A: 측정구간(시작=preconditioning 진입, 종료=laser 진입). LIVE 정의 동일.
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
  -- 이벤트 B: 4종 차감. 치료사 = performed_by. check_in_id 보존(정밀화 키). AC4: roster 한정.
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
  -- linked: A·B 매칭. check_in_id 정밀매칭 우선, NULL 시 (고객+KST일자) 근사. LIVE 정의 동일.
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
  -- AC3: 기준 축 = roster(치료사·재직). 모든 지표 동일 명단. 집계는 LEFT JOIN(0활동 재직 치료사도 노출).
  SELECT
    r.therapist_id                                         AS therapist_id,
    r.name                                                 AS name,
    COALESCE(d.tcount, 0)                                  AS treatment_count,
    CASE WHEN d.avg_min IS NOT NULL THEN ROUND(d.avg_min, 1) END AS avg_treatment_minutes,
    COALESCE(e.exp_total, 0)                               AS experience_total,
    COALESCE(e.exp_conv, 0)                                AS experience_converted,
    CASE WHEN COALESCE(e.exp_total, 0) > 0
      THEN ROUND(e.exp_conv::numeric / e.exp_total * 100, 1)
    END                                                    AS conversion_rate
  FROM roster r
  LEFT JOIN dur_agg d ON d.therapist_id = r.therapist_id
  LEFT JOIN exp_agg e ON e.therapist_id = r.therapist_id
  ORDER BY avg_treatment_minutes DESC NULLS LAST, r.name;
$$;

-- ─── 2) foot_stats_therapist_services (LIVE 6컬럼 그대로 + roster × 4종 grid anchor/필터) ──
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
  -- AC3·AC4 단일 소스: summary 와 동일한 staff '치료사·재직' 명단.
  roster AS (
    SELECT s.id AS therapist_id, s.name
    FROM staff s
    WHERE s.clinic_id = p_clinic_id
      AND s.role = 'therapist'
      AND s.active = true
  ),
  -- 4종 정규 라벨. roster × 4종 grid → 0활동 재직 치료사도 4줄(0건)로 일관 노출(지표 간 명단 동일).
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
    JOIN roster    r  ON r.therapist_id = ps.performed_by   -- AC4: 치료사·재직만
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
    JOIN roster r ON r.therapist_id = ci.therapist_id   -- AC4: 치료사·재직만
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
  -- linked 시간: check_in × treatment_type. check_in_id 정밀매칭 우선, NULL 시 근사. LIVE 정의 동일.
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
  -- AC3: 기준 축 = grid(roster × 4종). 분포/시간은 LEFT JOIN(0건도 노출).
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
  IS 'foot-stats: 평균치료시간+체험전환율. 명단 단일소스=staff(치료사·재직) roster. T-20260622-foot-STATS-THERAPIST-LOAD-STAFFFILTER (AC3·AC4)';
COMMENT ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE)
  IS 'foot-stats: 치료사 × 4종 분포+시술별 평균소요시간. 명단 단일소스=staff(치료사·재직) × 4종 grid. T-20260622-foot-STATS-THERAPIST-LOAD-STAFFFILTER (AC3·AC4)';

COMMIT;
