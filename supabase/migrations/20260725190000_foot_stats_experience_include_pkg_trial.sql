-- T-20260725-foot-PKG-TRIAL-VISITTYPE-EXPERIENCE-FIX — 패키지 체험권(session_type='trial') 차감 내원을
--   치료사 통계 '체험 건수(experience_total)'에 포함 (Option B = 집계단 픽스)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성: dev-foot / 2026-07-25
-- 롤백: 20260725190000_foot_stats_experience_include_pkg_trial.rollback.sql (LIVE 20260623130000 exp_agg 복원)
-- ref: ticket T-20260725-foot-PKG-TRIAL-VISITTYPE-EXPERIENCE-FIX / depends_on DIAG(done, normal_not_bug)
--      / 현장 C0ATE5P6JTH thread 1784979624.732659 "2번차트 패키지-체험권 발생 티켓은 전부 체험으로 잡혀야"
--
-- ⚠️ db_change = TRUE (집계 숫자 이동 = 비즈로직 변경). 단 테이블 스키마 변경 0건 · 데이터 DML 0건.
--    RPC 1종(foot_stats_therapist_summary) CREATE OR REPLACE (반환형·시그니처 무변경 → DROP 불요).
--    services RPC(foot_stats_therapist_services)는 무변경(체험권은 4종 시술 grid 대상 아님).
--
-- ─── 무엇을 바꾸나 (이 변경의 전부) ─────────────────────────────────────────────
--   summary 의 exp_agg(체험 판별)만 확장:
--     기존(LIVE): 체험 = base.visit_type = 'experience' 인 check_ins.
--     정정:       체험 = base.visit_type = 'experience'  OR  그 check_in 에 링크된
--                 package_sessions(session_type='trial', status='used') 이 1건 이상 존재.
--   COUNT(*) 는 base(check_ins) 행 기준 → visit_type/trial 양쪽 충족해도 1회만 카운트(중복 없음).
--   귀속 축·기간·취소제외·roster 요건은 LIVE 그대로(체험 귀속 = check_ins.therapist_id).
--
-- ─── 왜 (현장 의도) ─────────────────────────────────────────────────────────────
--   선(先)체험 접수 버튼 6/29 운영종료(T-20260629) 이후 visit_type='experience' 신규 생성경로 소멸
--   → experience_total 구조적 0(DIAG 확정, prod 실측 experience=1건뿐). 그러나 실제 '체험'은
--   패키지 내 체험권(trial_sessions) 차감(2번차트 금일치료='체험권')으로 계속 발생 중이며, 이는
--   package_sessions.session_type='trial' 로 저장되고 당일 내원 check_in 에 링크되지만 그 check_in 의
--   visit_type 은 접수 시점 값(new/returning) 그대로라 체험 집계에서 누락됨. 본 정정으로 링크 신호를 잡아 집계.
--
-- ─── 왜 Option B(집계단)인가 (Option A 저장단 대비) ─────────────────────────────
--   · visit_type 은 mutable 필드(오염 선례 body-EXPRESV-VISITTYPE-CONTAM) → 저장단 UPDATE 는 칸반 레인
--     재분류·타화면 visit_type 의존 사이드이펙트 위험. 집계단은 원본 visit_type 무접점.
--   · 소급 자동: 과거 trial 차감(package_sessions)은 이미 링크 존재 → 데이터 변경 0으로 과거·현재 전구간
--     자동 recompute(STABLE 조회시 재계산). 백필 DML·freeze셋·GO_WARN 백필게이트 불요.
--   · 롤백 용이(RPC 복원 1파일).
--
-- ─── prod 실측 (2026-07-25, read-only probe) ────────────────────────────────────
--   package_sessions session_type='trial': used 104(링크 103) / deleted 1.
--   trial(used) 링크 check_ins 103건 전부 visit_type='new'(therapist 有 103, cancelled 0) — 누락 실증.
--   본 정정 적용 시 roster(치료사·재직)·비취소 요건 충족으로 즉시 신규 반영 = 88건(전부 2026-07).
--   (103 → 88 갭 15건 = therapist_id 가 현 roster(role='therapist' AND active) 밖 → 기존 experience 지표와
--    동일한 roster 필터 동작. 새 갭 아님.)
--
-- ─── 체험→결제 전환율(conversion_rate) 주의 (현장/planner 고지) ───────────────────
--   exp_conv = 해당 check_in 의 package_id 에 package_payments(payment) 존재 여부로 판정.
--   실측(2026-07 dry-run): 신규 편입 88건의 experience_converted=0 / conversion_rate=0.0 —
--   trial-링크 check_ins 의 check_ins.package_id 가 NULL(또는 package_payments payment 행 부재)이라
--   EXISTS=false. 즉 전환율은 상향되지 않고 현재 0.0. (패키지-체험권 코호트는 이미 결제 후이지만
--   현 conversion 정의가 check_ins.package_id 링크에 의존 → 미계상.) experience_total(체험 건수)만
--   +88 반영되는 것이 본 티켓 목표. 전환율을 '체험 후 결제'로 재정의하려면 별건 정의 정정(dev 임의 변경 안 함).
--
-- 보안: SECURITY INVOKER(LIVE 동일, 명시 SET search_path). authenticated 만. anon 차단.

BEGIN;

-- ─── foot_stats_therapist_summary (LIVE 20260623130000 그대로 + exp_agg 체험 판별만 확장) ──
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
  --   종료=치료실 퇴실(from_status='preconditioning'인 최초 전이, 목적지 무관).
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
  -- [본 티켓 정정점] 체험 판별 = visit_type='experience' OR 패키지 체험권(trial) 차감 링크.
  --   COUNT(*) 는 base 행 기준 → 양쪽 충족해도 1회만(중복 카운트 없음).
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
       OR EXISTS (
         SELECT 1 FROM package_sessions ps
         WHERE ps.check_in_id = b.id
           AND ps.session_type = 'trial'
           AND ps.status = 'used'
       )
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
  IS 'foot-stats: 평균치료시간(치료실 체류=precond진입→치료실퇴실) + 체험전환율 + 지정치료사비율(옵션B). 체험=visit_type=experience OR 패키지 체험권(trial) 차감 링크(중복 1회). 명단 단일소스=staff(치료사·재직) roster. T-20260725-foot-PKG-TRIAL-VISITTYPE-EXPERIENCE-FIX (include pkg trial in experience count)';

COMMIT;
