-- ════════════════════════════════════════════════════════════════════════════
-- T-20260725-foot-ASSIGNHIST-DELETE-ALLROWS-R2B
-- 금일 배분 이력 row 삭제 = check_ins soft-hide (deleted_at + deleted_by)
--
-- 배경(reporter 김주연 총괄, 2026-07-25): 「상담·치료사 배정 > 금일 배분 이력」에서
--   잘못/테스트로 만들어진 배정 줄을 스태프(admin/manager/원장)가 직접 판단해 지운다.
--   R2(test-only 게이트)를 08:46 재정의로 폐지 → 전 행 노출. 지우는 방식은 soft-hide.
--
-- ★RED LINE (DA CONSULT-REPLY MSG-20260725-022505-y1fl GO 계승):
--   (a) hard-DELETE BANNED. check_ins 물리 DELETE 금지. 근거 = payments.check_in_id FK RESTRICT
--       + check_in_services ON DELETE CASCADE(시술내역/매출소스 소실) + package_sessions/
--       medical_charts/claims 다수 참조 → hard-DELETE 는 매출·원장 붕괴.
--       ⇒ deleted_at/deleted_by 컬럼 신설(ADDITIVE) + operational read-layer 전역 WHERE deleted_at IS NULL.
--   (d) downstream completeness: 내원/배정 count·KPI 소비처에서 soft-hidden 행 제외.
--       본 마이그가 커버하는 DB 집계 = foot_stats_consultant(★필수, 정합감사 A1/A2) +
--       foot_stats_noshow_returning(내원율 KPI). 나머지 FE count 소비처는 FE에서 .is('deleted_at', null).
--
-- 원자성: 단일 트랜잭션. ADDITIVE(ADD COLUMN IF NOT EXISTS) + CREATE OR REPLACE(집계 read-path).
--   데이터 변형 0(무-백필). 실패 시 전체 롤백.
-- 멱등: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) soft-hide 컬럼 신설 (ADDITIVE, 멱등) ─────────────────────────────────────
ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

COMMENT ON COLUMN public.check_ins.deleted_at IS
  'soft-hide 시각(KST-aware UTC). NOT NULL = 화면에서 숨김(운영 read 전역 WHERE deleted_at IS NULL). '
  'hard-DELETE 대체 — 결제/시술/원장 FK 보존, 복원가능(순소실0). T-20260725-foot-ASSIGNHIST-DELETE-ALLROWS-R2B.';
COMMENT ON COLUMN public.check_ins.deleted_by IS
  'soft-hide 실행자 profiles.id (감사용). admin/manager/원장 한정. T-20260725-foot-ASSIGNHIST-DELETE-ALLROWS-R2B.';

-- 운영 read 최빈 경로(오늘/당월 배분 이력·내원 집계)의 부분 인덱스 — deleted_at IS NULL 만.
CREATE INDEX IF NOT EXISTS idx_check_ins_live_clinic_checkedin
  ON public.check_ins (clinic_id, checked_in_at)
  WHERE deleted_at IS NULL;

-- ── 2) foot_stats_consultant — ★축별 분리(DA-20260725-...-MONEYSAFE) ─────────────
-- (DA CONSULT-REPLY MSG-20260725-091303-x4we / decision=DA-20260725-foot-ASSIGNHIST-SOFTHIDE-STATS-MONEYSAFE)
--   ★핵심: soft-hide 는 **축별로 다르게** 반영한다(초기 RED LINE d "전부 반영" 은 본 판정으로 refine 됨).
--     • count/ops 축(ticketing_count·consulted_customer_count) = soft-hide 반영(exclude-deleted, WHERE deleted_at IS NULL).
--     • ★매출귀속 축(ticketed_all → pkg_attr/single_attr → pkg_rev/single_rev) = deleted_at 미적용(원귀속 pin).
--       삭제행을 join 에 계속 포함 → 삭제 버튼이 매출을 次근접 상담사로 옮기지 않음(money-safe carve-out, B1).
--     • ★B2 비율-정합: avg_amount = 매출 / consulted_customer_count 는 rev/count 를 섞는 rate → 분모 leg 도
--       include-deleted 로 통일(consulted_cust_rev). 안 그러면 삭제 시 분모만 줄어 rate 인위 팽창 = money-bug.
--       단, 출력 컬럼 consulted_customer_count 자체는 순수 ops KPI 라 exclude-deleted(consulted_cust) 유지.
--   원본 = 20260724130000_foot_stats_consultant_singlepay_customer_attr.sql (verbatim + 축별 predicate).
CREATE OR REPLACE FUNCTION public.foot_stats_consultant(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  consultant_id            UUID,
  name                     TEXT,
  ticketing_count          INT,
  package_count            INT,
  avg_amount               BIGINT,
  total_amount             BIGINT,
  consulted_customer_count INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  -- count/ops 기반집합(date-bounded). deleted_at 을 컬럼으로 실어 축별로 분리 필터(아래 tk_count/consulted_cust).
  ticketed AS (
    SELECT DISTINCT
      ci.id          AS check_in_id,
      ci.consultant_id,
      ci.customer_id,
      ci.deleted_at                        -- 축 분리 캐리(soft-hide): count 축은 exclude, rate 분모는 include
    FROM check_ins ci
    JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.consultant_id IS NOT NULL
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
      AND st.to_status = 'consultation'
  ),
  -- money-safe carve-out: revenue anchor ignores deleted_at (R2B / DA-20260725-...-MONEYSAFE)
  --   ★B1: 매출귀속 앵커(ticketed_all→pkg_attr/single_attr→pkg_rev/single_rev)는 삭제행을 계속 포함(원귀속 pin).
  --   어떤 코드경로에서도 삭제행을 次근접 상담사로 re-anchor 하지 않는다(삭제=money-inert).
  ticketed_all AS (
    SELECT DISTINCT
      ci.id AS check_in_id,
      ci.consultant_id,
      ci.customer_id,
      ci.checked_in_at
    FROM check_ins ci
    JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.consultant_id IS NOT NULL     -- deleted_at 필터 없음(B1 원귀속 고정)
      AND st.to_status = 'consultation'
  ),
  pkg_attr AS (
    SELECT DISTINCT ON (p.id)
      p.id             AS package_id,
      ta.consultant_id AS consultant_id
    FROM packages p
    JOIN ticketed_all ta ON ta.customer_id = p.customer_id
    WHERE p.clinic_id = p_clinic_id
    ORDER BY
      p.id,
      (ta.checked_in_at <= p.created_at) DESC,
      ABS(EXTRACT(EPOCH FROM (p.created_at - ta.checked_in_at))) ASC,
      ta.check_in_id
  ),
  pkg_rev AS (
    SELECT
      pa.consultant_id,
      SUM(CASE WHEN pp.payment_type = 'refund' THEN -pp.amount ELSE pp.amount END)::bigint AS rev
    FROM package_payments pp
    JOIN pkg_attr pa ON pa.package_id = pp.package_id
    WHERE pp.clinic_id = p_clinic_id
      AND pp.accounting_date BETWEEN p_from AND p_to
    GROUP BY pa.consultant_id
  ),
  pkg_conv AS (
    SELECT
      pa.consultant_id,
      COUNT(DISTINCT pp.package_id)::int AS package_count
    FROM package_payments pp
    JOIN pkg_attr pa ON pa.package_id = pp.package_id
    WHERE pp.clinic_id = p_clinic_id
      AND pp.accounting_date BETWEEN p_from AND p_to
      AND pp.payment_type = 'payment'
    GROUP BY pa.consultant_id
  ),
  payment_base AS (
    SELECT
      pay.id                                    AS payment_id,
      pay.check_in_id                           AS check_in_id,
      COALESCE(pay.customer_id, ci.customer_id) AS customer_id,
      pay.created_at                            AS created_at,
      (CASE WHEN pay.payment_type = 'refund' THEN -pay.amount ELSE pay.amount END)::bigint AS net
    FROM payments pay
    LEFT JOIN check_ins ci ON ci.id = pay.check_in_id
    WHERE pay.clinic_id = p_clinic_id
      AND pay.accounting_date BETWEEN p_from AND p_to
  ),
  single_direct AS (
    SELECT DISTINCT ON (pb.payment_id)
      pb.payment_id,
      ta.consultant_id
    FROM payment_base pb
    JOIN ticketed_all ta ON ta.check_in_id = pb.check_in_id
    ORDER BY pb.payment_id, ta.check_in_id
  ),
  single_cust AS (
    SELECT DISTINCT ON (pb.payment_id)
      pb.payment_id,
      ta.consultant_id
    FROM payment_base pb
    JOIN ticketed_all ta ON ta.customer_id = pb.customer_id
    WHERE pb.payment_id NOT IN (SELECT payment_id FROM single_direct)
    ORDER BY
      pb.payment_id,
      (ta.checked_in_at <= pb.created_at) DESC,
      ABS(EXTRACT(EPOCH FROM (pb.created_at - ta.checked_in_at))) ASC,
      ta.check_in_id
  ),
  single_attr AS (
    SELECT payment_id, consultant_id FROM single_direct
    UNION ALL
    SELECT payment_id, consultant_id FROM single_cust
  ),
  single_rev AS (
    SELECT
      sa.consultant_id,
      SUM(pb.net)::bigint AS rev
    FROM single_attr sa
    JOIN payment_base pb ON pb.payment_id = sa.payment_id
    GROUP BY sa.consultant_id
  ),
  -- count/ops 축 = soft-hide 반영(exclude-deleted). ticketing_count 순수 배정건수 KPI.
  tk_count AS (
    SELECT t.consultant_id, COUNT(DISTINCT t.check_in_id)::int AS ticketing_count
    FROM ticketed t
    WHERE t.deleted_at IS NULL             -- R2B soft-hide 제외(ops count 축)
    GROUP BY t.consultant_id
  ),
  -- 출력 컬럼 consulted_customer_count = 순수 ops KPI → exclude-deleted.
  consulted_cust AS (
    SELECT t.consultant_id, COUNT(DISTINCT t.customer_id)::int AS consulted_customer_count
    FROM ticketed t
    WHERE t.deleted_at IS NULL             -- R2B soft-hide 제외(ops count 축)
    GROUP BY t.consultant_id
  ),
  -- ★B2 leg-통일: avg_amount(=매출/객수 rate)의 분모 leg. 분자(pkg_rev+single_rev)가 include-deleted(pin)이므로
  --   분모도 include-deleted 로 맞춰야 rate 정합(삭제 시 분모만 감소 → 인위 팽창=money-bug 방지). deleted_at 미필터.
  consulted_cust_rev AS (
    SELECT t.consultant_id, COUNT(DISTINCT t.customer_id)::int AS consulted_customer_count_rev
    FROM ticketed t
    GROUP BY t.consultant_id
  ),
  consultant_universe AS (
    SELECT consultant_id FROM tk_count
    UNION
    SELECT consultant_id FROM pkg_rev
    UNION
    SELECT consultant_id FROM single_rev
  )
  SELECT
    s.id   AS consultant_id,
    s.name AS name,
    COALESCE(tk.ticketing_count, 0)                                     AS ticketing_count,
    COALESCE(pc.package_count, 0)                                       AS package_count,
    -- ★B2: 분자=매출(include-deleted, pin) → 분모 leg 도 include-deleted(consulted_cust_rev)로 통일.
    --   출력 consulted_customer_count(exclude-deleted)와 의도적 분리 — soft-hide 시 rate 인위 팽창 차단.
    ROUND(
      (COALESCE(pr.rev, 0) + COALESCE(sr.rev, 0))::numeric
      / NULLIF(COALESCE(ccr.consulted_customer_count_rev, 0), 0)
    )::bigint                                                           AS avg_amount,
    (COALESCE(pr.rev, 0) + COALESCE(sr.rev, 0))::bigint                 AS total_amount,
    COALESCE(cc.consulted_customer_count, 0)                           AS consulted_customer_count
  FROM staff s
  JOIN consultant_universe cu ON cu.consultant_id = s.id
  LEFT JOIN tk_count           tk  ON tk.consultant_id  = s.id
  LEFT JOIN pkg_rev            pr  ON pr.consultant_id  = s.id
  LEFT JOIN pkg_conv           pc  ON pc.consultant_id  = s.id
  LEFT JOIN single_rev         sr  ON sr.consultant_id  = s.id
  LEFT JOIN consulted_cust     cc  ON cc.consultant_id  = s.id
  LEFT JOIN consulted_cust_rev ccr ON ccr.consultant_id = s.id
  WHERE s.clinic_id = p_clinic_id
    AND s.role = 'consultant'
  GROUP BY s.id, s.name, tk.ticketing_count, pc.package_count, pr.rev, sr.rev, cc.consulted_customer_count, ccr.consulted_customer_count_rev
  ORDER BY ticketing_count DESC, avg_amount DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) TO authenticated;

-- ── 3) foot_stats_noshow_returning — ck CTE 에 deleted_at IS NULL 추가 ────────────
-- (내원율 KPI. returning_rate 분모/분자에서 soft-hidden 행 제외. 그 외 로직 불변.)
-- 원본 = 20260629150000_foot_resv_status_noshow_to_no_show.sql (verbatim + 1 predicate).
CREATE OR REPLACE FUNCTION public.foot_stats_noshow_returning(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  dt              DATE,
  noshow_rate     NUMERIC,
  returning_rate  NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH res AS (
    SELECT
      reservation_date AS dt,
      COUNT(*) FILTER (WHERE status = 'no_show')                             AS noshow_cnt,
      COUNT(*) FILTER (WHERE status IN ('checked_in','no_show'))             AS denom_cnt
    FROM reservations
    WHERE clinic_id = p_clinic_id
      AND reservation_date BETWEEN p_from AND p_to
    GROUP BY 1
  ),
  ck AS (
    SELECT
      (checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
      COUNT(*) FILTER (WHERE visit_type = 'returning')  AS returning_cnt,
      COUNT(*)                                          AS total_cnt
    FROM check_ins
    WHERE clinic_id = p_clinic_id
      AND deleted_at IS NULL                -- R2B soft-hide 제외
      AND checked_in_at IS NOT NULL
      AND status NOT IN ('cancelled')
      AND (checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
    GROUP BY 1
  )
  SELECT
    COALESCE(r.dt, c.dt) AS dt,
    CASE
      WHEN COALESCE(r.denom_cnt, 0) > 0
      THEN ROUND((r.noshow_cnt::numeric / r.denom_cnt) * 100, 1)
      ELSE 0
    END AS noshow_rate,
    CASE
      WHEN COALESCE(c.total_cnt, 0) > 0
      THEN ROUND((c.returning_cnt::numeric / c.total_cnt) * 100, 1)
      ELSE 0
    END AS returning_rate
  FROM res r
  FULL OUTER JOIN ck c ON c.dt = r.dt
  ORDER BY 1;
$$;

-- 검증: 컬럼 신설 확인 (실패 시 EXCEPTION → 롤백)
DO $$
DECLARE v_cnt INT;
BEGIN
  SELECT count(*) INTO v_cnt
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'check_ins'
     AND column_name IN ('deleted_at','deleted_by');
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'R2B soft-hide 컬럼 신설 실패: % / 2 — 롤백', v_cnt;
  END IF;
END $$;

COMMIT;
