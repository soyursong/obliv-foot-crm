-- T-20260607-foot-THERAPIST-STATS — 치료사 기준 통계 RPC 2종 (어드민 전용)
-- 신규 RPC만 추가 (테이블 컬럼 변경 0건). 기존 foot_stats_* RPC 패턴 재사용.
--   - foot_stats_therapist_summary  : 지표1(평균 치료시간) + 지표4(체험→결제 전환율) per 치료사
--   - foot_stats_therapist_services : 지표2(시술 종류 분포) per 치료사 × 시술명
-- 지표3(지정 치료사 비율)은 check_ins 에 '지정 여부' 컬럼이 부재하여 본 RPC 미포함 (FE placeholder + FOLLOWUP).
--
-- 보안: SECURITY INVOKER. 호출자 RLS(is_approved_user) 통과. authenticated 만. anon 차단.
-- 권한: clinic_id 필수, 기간(p_from~p_to) 필수.
-- 귀속: check_ins.therapist_id. cancelled 제외.
-- 성능: 기간 필터 강제 + status_transitions(check_in_id, to_status) 부분 인덱스 보강(additive, IF NOT EXISTS).

-- 성능 보강 인덱스 (지표1 전환시각 차 집계 대비). 비파괴 additive.
CREATE INDEX IF NOT EXISTS idx_status_transitions_checkin_tostatus
  ON status_transitions (check_in_id, to_status, transitioned_at);

-- ─── 1) foot_stats_therapist_summary ────────────────────────────────────────
-- 지표1 평균 치료시간: 치료 시작(최초 preconditioning|laser 진입) → 완료(최종 done 전환) 시각 차의 치료사별 평균(분).
-- 지표4 체험→결제 전환율: visit_type='experience' 건 중 package_id 에 정상 패키지 결제(payment)가 있는 비율.
-- 치료사 리스트는 기간 내 check_in 을 1건이라도 수행한 therapist_id 기준(데이터 없는 지표는 NULL/0).
CREATE OR REPLACE FUNCTION foot_stats_therapist_summary(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  therapist_id          UUID,
  name                  TEXT,
  treatment_count       INT,     -- 치료시간 산출 가능 건수 (시작+완료 모두 존재)
  avg_treatment_minutes NUMERIC, -- 평균 치료시간(분, 소수 1자리). 데이터 없으면 NULL
  experience_total      INT,     -- 체험 내원 건수
  experience_converted  INT,     -- 그중 패키지 결제 전환 건수
  conversion_rate       NUMERIC  -- 0.0 ~ 100.0 (experience_total=0 이면 NULL)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT ci.id, ci.therapist_id, ci.visit_type, ci.package_id
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
    -- check_in 단위 치료시간(분). 시작=최초 preconditioning|laser, 완료=최종 done.
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

-- ─── 2) foot_stats_therapist_services ───────────────────────────────────────
-- 지표2 시술 종류 분포: 치료사별 시술명별 건수.
CREATE OR REPLACE FUNCTION foot_stats_therapist_services(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  therapist_id UUID,
  name         TEXT,
  service_name TEXT,
  cnt          INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    ci.therapist_id        AS therapist_id,
    s.name                 AS name,
    cis.service_name       AS service_name,
    COUNT(*)::int          AS cnt
  FROM check_in_services cis
  JOIN check_ins ci ON ci.id = cis.check_in_id
  JOIN staff s      ON s.id = ci.therapist_id
  WHERE ci.clinic_id = p_clinic_id
    AND ci.therapist_id IS NOT NULL
    AND ci.status <> 'cancelled'
    AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
  GROUP BY ci.therapist_id, s.name, cis.service_name
  ORDER BY s.name, cnt DESC;
$$;

-- 권한: authenticated 만. anon 차단.
REVOKE ALL ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  FROM PUBLIC;
REVOKE ALL ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  TO authenticated;
GRANT EXECUTE ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)
  IS 'foot-stats: 치료사 평균 치료시간 + 체험→결제 전환율. T-20260607-foot-THERAPIST-STATS';
COMMENT ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE)
  IS 'foot-stats: 치료사별 시술 종류 분포. T-20260607-foot-THERAPIST-STATS';
