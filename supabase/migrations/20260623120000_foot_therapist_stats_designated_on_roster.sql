-- T-20260622-foot-STATS-MIGRATION-DRIFT-2PHANTOM — AC2: 지정치료사 비율(지표3) 복원 (roster 베이스)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성: dev-foot / 2026-06-23
-- 롤백: 20260623120000_foot_therapist_stats_designated_on_roster.rollback.sql (LIVE 7컬럼 roster 정의로 복원)
-- ref: planner NEW-TASK MSG-20260622-214617 / 트리아지 db-gate/T-...-2PHANTOM_triage.md
--
-- ⚠️ db_change = FALSE — 테이블 스키마 변경 0건. RPC 1종 재정의(DROP+CREATE)만.
--    반환 컬럼 3종 추가(designated_count/total_checkin_count/designated_rate) → 시그니처 변경 ∴ DROP 선행.
--
-- ─── 무엇을 / 왜 ────────────────────────────────────────────────────────────
--   phantom 마이그 20260609220000_designated_ratio 는 지표3(지정치료사 비율)을 designed 했으나
--   PROD 미적용(phantom) ∴ FE 지표3 가 현재 빈 값(7컬럼 LIVE 에 designated 3종 부재).
--   그 stale 파일은 roster 도입(20260622120000) 이전 정의라 원형 재적용 시 AC3/AC4(roster 단일소스·
--   재직 치료사 한정)를 회귀시킨다. → 파일 원형이 아니라 **현 LIVE(roster) 정의 위에 designated 만 재구성**.
--
-- ─── 베이스 = 현 LIVE(20260622120000_staff_source_filter) summary, 한 줄도 안 바꿈 (회귀 0) ──
--   roster anchor(staff role='therapist' AND active), 측정창 종료=to_status='laser'(레이저 진입),
--   check_in_id 정밀매칭+근사 fallback, 체험전환율, IV 제외 — 전부 보존.
--   ⊕ 추가: desig_agg(옵션B, 김주연 2026-06-09 확정 산식) — 분모=roster base 전체 check_in,
--           분자=customers.designated_therapist_id == check_ins.therapist_id 일치. base 가 이미
--           roster JOIN 이므로 designated 도 AC4(재직 치료사) 자동 준수.
--   services RPC 는 손대지 않음(6컬럼 LIVE 정상 — split-brain 방지).
--
-- 보안: SECURITY INVOKER(LIVE 동일, 명시 SET search_path). authenticated 만. anon 차단.

BEGIN;

-- 반환 컬럼 추가 → 시그니처 변경 → DROP 선행 필수.
DROP FUNCTION IF EXISTS foot_stats_therapist_summary(UUID, DATE, DATE);
CREATE FUNCTION foot_stats_therapist_summary(
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
  designated_count      INT,     -- ★복원: 지정 일치 check_in 수(분자)
  total_checkin_count   INT,     -- ★복원: roster base 전체 check_in 수(분모)
  designated_rate       NUMERIC  -- ★복원: 지정치료사 비율(%, 소수1). 분모0이면 NULL
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
  -- ★ AC2 지정치료사 비율(옵션B, 20260609220000 산식 동일): check_ins.therapist_id == customers.designated_therapist_id.
  --   분모 = roster base 전체 check_in, 분자 = 지정 일치 check_in. base 가 roster JOIN ∴ AC4 자동 준수.
  --   designated_therapist_id NULL 고객은 자동 불일치 → 분자 제외.
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

REVOKE ALL ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  TO authenticated;

COMMENT ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)
  IS 'foot-stats: 평균치료시간+체험전환율+지정치료사비율(옵션B). 명단 단일소스=staff(치료사·재직) roster. T-20260622-foot-STATS-MIGRATION-DRIFT-2PHANTOM (designated on roster)';

COMMIT;
