-- T-20260725-foot-CONVERSION-EXCLUDE-ONETIME-TICKET — 치료사 통계 '전환(experience_converted)' 분자 재정의.
--   전환 = "체험권 차감 내원 → 당일 신규 정식(다회차) 패키지 티켓 발행" 케이스만. 1회성(단건) 티켓·체험권 발행은 전환 X.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성: dev-foot / 2026-07-25
-- 롤백: 20260725200000_foot_stats_conversion_exclude_onetime.rollback.sql (LIVE 20260725190000 exp_agg 복원)
-- ref: ticket T-20260725-foot-CONVERSION-EXCLUDE-ONETIME-TICKET
--      / 총괄 확정 SSOT(김주연 총괄 C0ATE5P6JTH, slack ts 1784983193.079089, via planner MSG-20260725-214656-ci8j)
--      / 선행 배포 depends_on 20260725190000(PKG-TRIAL-EXPERIENCE, experience_total 확장) — 본건은 그 위에서 전환 분자만 좁힘.
--
-- ⚠️ db_change = TRUE (전환 분자 = 비즈로직 변경). 단 테이블 스키마 변경 0건 · 데이터 DML 0건.
--    RPC 1종(foot_stats_therapist_summary) CREATE OR REPLACE (반환형·시그니처 10컬럼 무변경 → DROP 불요, 42P13 불가).
--    변경 범위 = exp_agg 의 exp_conv(전환 분자) 판별식 1곳뿐. 분모(exp_total)·체험 판별·측정창·roster·지정비율 전부 LIVE 그대로.
--
-- ─── 총괄 확정 SSOT (전환 분자 정의) ────────────────────────────────────────────
--   ⭐ 전환(분자) = 체험권 차감 내원 → 당일 신규 패키지 티켓 발행 케이스만 카운팅.
--   ⭐ 1회성 티켓 차감 내원 → 패키지 발행 = 전환율 분자에서 제외(반영 금지).
--   즉 트리거 = "체험권(trial) 차감 내원"(= 분모 모집단), 그 방문 당일(KST) 신규 '정식 패키지'가 발행돼야 전환 1건.
--
-- ─── 무엇을 바꾸나 (이 변경의 전부) ─────────────────────────────────────────────
--   [기존 LIVE exp_conv] check_in 자기 package_id(b.package_id)에 package_payments(payment) 존재 여부.
--     → 문제: 체험권(trial) 차감 내원 check_in 은 package_id=NULL 이라 EXISTS=false → 전환 구조적 0(무의미).
--   [정정 exp_conv] 같은 고객(customer_id)에게 '체험 내원일(KST)과 같은 날' 발행된 '정식 패키지'가 1건 이상 존재하면 전환.
--     '정식 패키지' = packages 중 (a) 미취소·미환불, (b) 다회차(total_sessions>=2),
--       (c) 체험권 아님(package_type 에 '체험' 미포함 AND treatment_type<>'체험권'),
--       (d) 1회성·템플릿 아님(total_sessions>=2 로 1회성 단건 자동 배제 + package_type NOT IN('template','preset_12')),
--       (e) 양도받은 것 아님(transferred_from IS NULL = '신규' 발행).
--   COUNT(*) 는 base(check_ins) 행 기준 → 중복 없음. 분모(exp_total)는 LIVE 정의 그대로(무회귀).
--
-- ─── 왜 이 판별식인가 (1회성/체험권 제외 근거) ──────────────────────────────────
--   · '1회성 티켓'(단건 레이저: AF/오니코/힐러/아톰레이저, custom 단건) = total_sessions=1 → (b) 로 제외.
--   · '체험권'(무좀/내성/일반 체험권, 2회차 체험권 포함) = (c) 로 제외(2회차 체험권도 정식 전환 아님).
--   · 트리거 자체가 '체험권 차감 내원'(분모 모집단)이라 '1회성 티켓 차감 내원'은 애초에 분모에 없음 → 이중 안전.
--   · '당일'(contract_date=kst_date) = 총괄 명시 요건. 나중날 정식 패키지 구매는 전환 미집계(SSOT).
--
-- ─── prod 실측 (2026-07-25, read-only dry-run) ──────────────────────────────────
--   experience_total(분모): 2026-07 = 88, 2026-06 = 1 (LIVE 무회귀 — 본 변경은 분모 무접점).
--   experience_converted(분자, 신규 정의): 2026-07 = 0, 2026-06 = 0, 전기간 = 0.
--   → LIVE exp_conv(=0) 대비 delta = 0. 즉 화면상 전환 수치 변화 없음(0.0 유지)이나, 정의가 SSOT 부합으로 교정되어
--     이후 실제 '체험→당일 정식패키지' 전환 발생 시 정상 계상되고, 1회성/체험권은 절대 분자에 안 들어감.
--   전기간 참고: '체험 고객이 (당일 아닌) 나중에 정식패키지를 산' 케이스 1건 존재 → '당일' 요건으로 정상 제외(SSOT 부합).
--   집계단(recompute) 수정이라 원본 무접점 → 과거 전구간 자동 재집계. 백필 DML/freeze셋 불요(delta=0, 소급 숫자 무변동).
--
-- 보안: SECURITY INVOKER(LIVE 동일, 명시 SET search_path). authenticated 만. anon 차단.

BEGIN;

-- ─── foot_stats_therapist_summary (LIVE 20260725190000 그대로 + exp_agg 의 exp_conv 분자만 재정의) ──
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
  -- [본 티켓 정정점] exp_total(분모) = LIVE 그대로: 체험 = visit_type='experience' OR 패키지 체험권(trial) 차감 링크.
  --   exp_conv(분자) = SSOT 재정의: 그 체험 내원 '당일(KST)' 같은 고객에게 신규 '정식 패키지' 발행 → 전환.
  --   정식 패키지 = 미취소·미환불 + 다회차(>=2, 1회성 단건 배제) + 체험권 아님 + 템플릿 아님 + 양도아님(신규).
  exp_agg AS (
    SELECT b.therapist_id,
           COUNT(*)::int AS exp_total,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM packages pk
             WHERE pk.clinic_id      = p_clinic_id
               AND pk.customer_id    = b.customer_id
               AND pk.contract_date  = b.kst_date                    -- 당일 발행
               AND pk.status NOT IN ('cancelled','refunded')
               AND pk.total_sessions >= 2                            -- 정식(다회차) — 1회성 단건 제외
               AND COALESCE(pk.package_type, '') NOT ILIKE '%체험%'  -- 체험권 제외(2회차 체험권 포함)
               AND COALESCE(pk.treatment_type, '') <> '체험권'
               AND pk.package_type NOT IN ('template','preset_12')   -- 템플릿/프리셋 아티팩트 제외
               AND pk.transferred_from IS NULL                       -- 신규 발행만(양도받은 것 제외)
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
  IS 'foot-stats: 평균치료시간(치료실 체류) + 체험전환율 + 지정치료사비율(옵션B). 체험(분모)=visit_type=experience OR 패키지 체험권(trial) 차감 링크. 전환(분자)=체험 내원 당일 신규 정식(다회차·비체험권·비1회성·비양도) 패키지 발행. roster 단일소스. T-20260725-foot-CONVERSION-EXCLUDE-ONETIME (1회성/체험권 발행은 전환 제외).';

COMMIT;
