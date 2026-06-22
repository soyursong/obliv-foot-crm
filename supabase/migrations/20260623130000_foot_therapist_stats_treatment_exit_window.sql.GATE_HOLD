-- T-20260623-foot-STATS-TREATMENT-EXIT-WINDOW — AC3: 측정창 종료기준 변경 (레이저 진입 → 치료실 퇴실)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성: dev-foot / 2026-06-23
-- 롤백: 20260623130000_foot_therapist_stats_treatment_exit_window.rollback.sql (laser-end 측정창으로 복원)
-- ref: MSG-20260623-024501-5zkr(FOLLOWUP) / 김주연 총괄 product B confirm MSG-20260623-082814-wrfs
--      / DA CONSULT-REPLY MSG-20260623-032609-hs8z (AC2 사전 종결, recompute 경로 GO)
--      / coverage 실측 db-gate/T-20260623-foot-STATS-TREATMENT-EXIT-WINDOW_coverage.md
--
-- ⚠️ db_change = TRUE (집계 숫자 이동 = 비즈로직 변경). 단 테이블 스키마 변경 0건.
--    RPC 2종 CREATE OR REPLACE(반환형·시그니처 무변경 → DROP 불요) + 종료조건 탐색 인덱스 1종(additive).
--
-- ─── 무엇을 바꾸나 (이 변경의 전부) ─────────────────────────────────────────────
--   측정창 종료조건만 정정:
--     기존(LIVE): 종료 = 최초 to_status='laser'(레이저실 진입).
--     정정:       종료 = 치료실 슬롯을 떠나는 최초 전이 = from_status='preconditioning'(목적지 무관:
--                 laser/done/healer_waiting/laser_waiting 등 임의 다음 슬롯).
--   시작(to_status='preconditioning' 진입)은 불변. summary·services 동일 측정창 공유(split-brain 방지).
--
-- ─── 왜 (현장 의도, 김주연 총괄) ────────────────────────────────────────────────
--   "꼭 레이저실이 아니더라도 치료실에서 다른 슬롯 이동 시 데이터로 정정. 치료 내용에 따라 레이저실
--    안 가는 경우도 존재. 핵심은 고객이 '치료실에서 머문 시간' 추출." (product B confirm 2026-06-23 08:28)
--   현 laser 종료조건은 레이저실 미방문 세션(치료실→done, 치료실→힐러 등)의 종료 이벤트를 못 잡아
--   평균치료시간 집계에서 통째 누락 → 정정으로 집계 포함. windowable 56.8% → 93.8% (+37pp).
--
-- ─── ★ 베이스 주의 (2PHANTOM AC3/AC4 회귀 금지) ─────────────────────────────────
--   원형 phantom 0612(20260612130000_..._treatment_exit, GATE_HOLD)는 roster 도입 이전 정의(check_in_id
--   정밀매칭·designated·roster anchor 없음) → 그대로 적용 금지. 본 마이그는 현 LIVE 정의를 베이스로:
--     · summary  = 20260623120000(roster·designated 10컬럼·정밀매칭) 위에 end_at 한 줄만 정정.
--     · services = 20260622120000(roster×4종 grid·정밀매칭 6컬럼) 위에 end_at 한 줄만 정정.
--   designated 산식·roster anchor·체험전환율·정밀매칭 fallback·반환형 — 전부 LIVE 그대로 보존.
--
-- ─── 시계열 (DA 사전승인 — recompute 경로) ──────────────────────────────────────
--   summary/services 는 STABLE 함수(데이터 무변경, 조회 시 재계산). foot shallow-history(05-07~) +
--   from_status='preconditioning' 전이 전구간 적재(05월 131·06월 240) ⟹ 정의 교체만으로 과거·현재
--   전 구간 자동 recompute. effective_date 경계·backfill 배치·혼합 추세선 불요(DA MSG-20260623-032609-hs8z).
--   종료점이 status 전이값 기반(room_id 비참조) → room_id 0% 무관.
--
-- ─── 숫자 이동 규모 (AC5 현장 사전고지 근거) ────────────────────────────────────
--   평균치료시간 14.7분 → 37.3분(약 2.5배↑), treatment_count +3. 표본 작아 방향·배율이 의미.
--   "이 날짜부터 평균치료시간이 약 2.5배로 보이는 건 정의 개선(치료실 전체 체류 포착)" 안내 동반(AC5).
--
-- 보안: SECURITY INVOKER(LIVE 동일, 명시 SET search_path). authenticated 만. anon 차단.

BEGIN;

-- 성능 보강(비파괴 additive): from_status 종료조건 탐색용 인덱스.
CREATE INDEX IF NOT EXISTS idx_status_transitions_checkin_fromstatus
  ON status_transitions (check_in_id, from_status, transitioned_at);

-- ─── 1) foot_stats_therapist_summary (LIVE 20260623120000 그대로 + end_at 정정) ──
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
  --   ★종료=치료실 퇴실(from_status='preconditioning'인 최초 전이, 목적지 무관). [본 티켓 정정점]
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
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM package_payments pp
             WHERE pp.package_id = b.package_id
               AND pp.payment_type = 'payment'
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

-- ─── 2) foot_stats_therapist_services (LIVE 20260622120000 그대로 + end_at 정정) ──
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
  -- ★종료=치료실 퇴실(from_status='preconditioning'). summary 와 동일 측정창. [본 티켓 정정점]
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
  IS 'foot-stats: 평균치료시간(치료실 체류=precond진입→치료실퇴실 from_status=preconditioning) + 체험전환율 + 지정치료사비율(옵션B). 명단 단일소스=staff(치료사·재직) roster. T-20260623-foot-STATS-TREATMENT-EXIT-WINDOW (treatment-exit on roster)';
COMMENT ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE)
  IS 'foot-stats: 치료사 × 4종 분포 + 시술별 평균소요시간(치료실 체류창, summary 동일). 명단 단일소스=staff(치료사·재직) × 4종 grid. T-20260623-foot-STATS-TREATMENT-EXIT-WINDOW (treatment-exit on roster)';

COMMIT;
