-- T-20260607-foot-THERAPIST-STATS-V2 — SPEC-CORRECTION: 측정 종료조건 정정 (치료실 퇴실 ts)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-06-12
-- 롤백: 20260612130000_foot_therapist_stats_treatment_exit.rollback.sql
-- ref: MSG-20260612-131947 (planner FIX-REQUEST) / 김주연 총괄 U0ATDB587PV
--
-- ⚠️ db_change = FALSE — 스키마 변경 0건. RPC(CREATE OR REPLACE) 2종만. 반환형 무변경 → DROP 불요.
--
-- ─── 무엇을 정정하나 (AC2·AC3) ───────────────────────────────────────────────
--   기존(배포본 20260609220000): 측정 종료 = 최초 to_status='laser'(레이저실 진입).
--   정정:                        측정 종료 = 치료실 슬롯을 떠나는 최초 전이
--                                = from_status='preconditioning'(치료실)인 가장 이른 transitioned_at.
--                                  목적지 무관(laser/done/healer_waiting/laser_waiting 등 임의 다음 슬롯).
--
-- ─── 왜 (현장 의도) ──────────────────────────────────────────────────────────
--   김주연 총괄: "꼭 레이저실이 아니더라도 치료실에서 다른 슬롯 이동 시 데이터로 정정.
--     치료 내용에 따라 레이저실 안 가는 경우도 존재. 핵심은 고객이 '치료실에서 머문 시간' 추출."
--   현 laser 종료조건은 레이저실 미방문 세션(치료실→done, 치료실→힐러 등)의 종료 이벤트를
--   못 잡아 평균치료시간 집계에서 통째 누락 → 정정으로 집계 포함.
--
-- ─── 그라운딩 (착수 전 코드 확정) ───────────────────────────────────────────
--   · 치료실 슬롯 status = 'preconditioning' (src/lib/status.ts: '치료실').
--   · status_transitions.from_status TEXT NOT NULL (20260419000000_initial_schema). 존재 확정.
--   · from_status='preconditioning' = "치료실을 직전에 머문 슬롯으로 두고 떠나는 전이"
--     (기존 fn_check_in_slot_dwell 20260602230000 동일 모델 재사용).
--   · 시작=MIN(to_status='preconditioning') 입장 전이는 항상 종료 전이보다 이르므로(입장 후에만 퇴실 가능)
--     end_at > start_at 가드 자연 성립. 미퇴실 세션(end NULL)은 pending → 집계 제외(정상).
--   · 별도 staging 테이블 불요 — 기존 status_transitions row 재활용 유지(db_change=false).
--
-- ─── 변경 범위 ──────────────────────────────────────────────────────────────
--   AC2·AC3 정정. AC1·AC4·AC5·AC6·AC7 계약(반환형·분포 cnt·지정비율·권한) 무변경.
--   summary: avg_treatment_minutes / treatment_count 의 측정창 정정.
--   services: 동일 측정창 공유 → avg_minutes/linked_count 정정(분포 cnt·반환형 불변, split-brain 방지).
--
-- 보안: SECURITY INVOKER. authenticated 만. anon 차단. (기존 정책 동일 유지)

BEGIN;

-- 성능 보강(비파괴 additive): from_status 종료조건 탐색용 인덱스.
CREATE INDEX IF NOT EXISTS idx_status_transitions_checkin_fromstatus
  ON status_transitions (check_in_id, from_status, transitioned_at);

-- ─── 1) foot_stats_therapist_summary (LIVE 20260609220000 shape 유지: 10컬럼 designated 포함) ──
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
  -- 이벤트 A: AC2 측정구간. 시작=치료실 진입(to_status='preconditioning'),
  --   종료=치료실 퇴실(from_status='preconditioning'인 최초 전이, 목적지 무관). 둘 다 있고 종료>시작.
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
  -- AC2 지정치료사 비율(옵션 B, 20260609220000 유지): check_ins.therapist_id == customers.designated_therapist_id.
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

-- ─── 2) foot_stats_therapist_services (반환형 6컬럼 유지: 분포 cnt 불변, 측정창만 정정) ──
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
  WITH cat AS (
    SELECT
      ps.id,
      ps.performed_by AS therapist_id,
      c.id            AS customer_id,
      ps.session_date AS kst_date,
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
  -- AC2 측정구간 정정: 종료 = 치료실 퇴실(from_status='preconditioning'). summary 와 동일 측정창.
  a_events AS (
    SELECT b.id AS check_in_id, b.therapist_id, b.customer_id, b.kst_date,
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
  dist AS (
    SELECT therapist_id, treatment_type, COUNT(*)::int AS cnt
    FROM cat
    GROUP BY therapist_id, treatment_type
  ),
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
  IS 'foot-stats v2+: 평균치료시간(치료실 체류=precond진입→치료실퇴실) + 체험전환율 + 지정치료사비율. T-20260607-foot-THERAPIST-STATS-V2 (treatment-exit 정정)';
COMMENT ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE)
  IS 'foot-stats v2: 치료사 × 4종 분포 + 시술별 평균소요시간(치료실 체류창, summary 동일). T-20260607-foot-THERAPIST-STATS-V2 (treatment-exit 정정)';

COMMIT;
