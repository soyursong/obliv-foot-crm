-- T-20260607-foot-CHECKIN-DESIGNATED-FLAG — 치료사 통계 '지정치료사 비율' 활성화 (옵션 B 확정)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-06-09
-- 롤백: 20260609220000_foot_therapist_stats_designated_ratio.rollback.sql
--
-- ⚠️ db_change = FALSE — 스키마 변경 0건. RPC foot_stats_therapist_summary 재정의(DROP+CREATE)만.
--   ⚠ 반환 컬럼 3종 추가(designated_count/total_checkin_count/designated_rate) → CREATE OR REPLACE 불가, DROP 선행.
--   ⚠ LOAD-FAIL 동일 RPC군: 적용 후 통계 탭 로드 무회귀 재확인 필수(supervisor 함수 적용 게이트).
--
-- 결정(2026-06-09, 김주연 총괄): 분자 판정 기준 3안 데드락 → 옵션 B 확정.
--   지정 판정 = check_ins.therapist_id == customers.designated_therapist_id (read-only JOIN, 입력0, DB변경0).
--
-- AC2 (계산식): per therapist
--   designated_count     = COUNT(check_ins WHERE check_ins.therapist_id = customers.designated_therapist_id)
--   total_checkin_count  = COUNT(전체 check_ins)          ← summary 의 base CTE 와 동일 모집단
--   designated_rate      = designated_count / total_checkin_count * 100  (소수1, total=0 이면 NULL)
-- AC5 (무회귀): designated_therapist_id NULL 고객 check_in 은 분자 자동제외(= 컬럼이 NULL → therapist_id 와 불일치).
--   데이터0 치료사는 LEFT JOIN + COALESCE 로 designated_rate=NULL → 화면 '데이터 없음'.
--
-- 보안: SECURITY INVOKER. authenticated 만. anon 차단. (기존 정책 동일 유지)

BEGIN;

-- 반환 컬럼 추가 → DROP 선행 필수.
DROP FUNCTION IF EXISTS foot_stats_therapist_summary(UUID, DATE, DATE);
CREATE FUNCTION foot_stats_therapist_summary(
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
  conversion_rate       NUMERIC,
  designated_count      INT,     -- ★신규: 지정 일치 check_in 수(분자)
  total_checkin_count   INT,     -- ★신규: 전체 check_in 수(분모)
  designated_rate       NUMERIC  -- ★신규: 지정치료사 비율(%, 소수1). 분모0이면 NULL
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
  ),
  -- ★ AC2 지정치료사 비율(옵션 B): check_ins.therapist_id == customers.designated_therapist_id.
  --   분모 = 해당 치료사의 전체 check_in(base), 분자 = 지정 일치 check_in.
  --   designated_therapist_id NULL 고객은 자동 불일치 → 분자 제외(AC5).
  desig_agg AS (
    SELECT b.therapist_id,
           COUNT(*)::int AS total_cnt,
           COUNT(*) FILTER (WHERE c.designated_therapist_id = b.therapist_id)::int AS desig_cnt
    FROM base b
    JOIN customers c ON c.id = b.customer_id
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
    END                                                    AS conversion_rate,
    COALESCE(g.desig_cnt, 0)                               AS designated_count,
    COALESCE(g.total_cnt, 0)                               AS total_checkin_count,
    CASE WHEN COALESCE(g.total_cnt, 0) > 0
      THEN ROUND(g.desig_cnt::numeric / g.total_cnt * 100, 1)
    END                                                    AS designated_rate
  FROM therapists t
  JOIN staff s        ON s.id = t.therapist_id
  LEFT JOIN dur_agg d ON d.therapist_id = t.therapist_id
  LEFT JOIN exp_agg e ON e.therapist_id = t.therapist_id
  LEFT JOIN desig_agg g ON g.therapist_id = t.therapist_id
  WHERE s.clinic_id = p_clinic_id
  ORDER BY avg_treatment_minutes DESC NULLS LAST, s.name;
$$;

REVOKE ALL ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  TO authenticated;

COMMENT ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)
  IS 'foot-stats v2+: 치료사 평균치료시간 + 체험전환율 + 지정치료사비율(옵션B, designated_therapist_id JOIN). T-20260607-foot-CHECKIN-DESIGNATED-FLAG';

COMMIT;
