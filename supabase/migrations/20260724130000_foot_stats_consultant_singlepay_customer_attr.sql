-- ============================================================
-- T-20260724-foot-CONSULTANT-TKTREV-SINGLEPAY-ATTR-FIX
-- foot_stats_consultant '상담실장 티켓팅 실적' 단건결제(single_rev) WHO 귀속을
--   pkg_rev 의 customer→consultant 귀속과 byte-동형화(발명 금지, 함수 재사용).
--   DA-20260724-FOOTDOSU-STATS-REGCOUNSELOR-WHO-CANON verdict=GO(조건부, Surface2, ADDITIVE·read-path).
-- Base : 20260717170000_foot_stats_consultant_arpu_consulted_denom (7-col, 현행 live).
--        pkg_attr / pkg_rev / consulted_cust / avg_amount / 반환형 = 전부 불변 재사용 → drift 0.
-- DB   : rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성 : dev-foot / 2026-07-24
-- 롤백 : 20260724130000_foot_stats_consultant_singlepay_customer_attr.rollback.sql (= 0717170000 body 복원)
-- 증거 : 20260724130000_foot_stats_consultant_singlepay_customer_attr.evidence.mjs (AC-2 before/after prod 재현)
-- 표준 : Migration Ledger Reconciliation / Migration Dry-Run No-Persistence Protocol
--
-- ─── 왜 재설계인가 (single_rev WHO 붕괴 RC) ───────────────────────────────────────
--   구 single_rev 는 단건결제 귀속을 `payments.check_in_id = ticketed_all.check_in_id`
--   직접조인 1경로에만 의존했다. 그러나 check_in_id 가 NULL(영수증 수납/업로드 단건 등)이거나
--   상담(ticketed) 체크인이 아닌 체크인(치료-only 등)을 가리키면 → 조인 실패 → 통째 누락.
--   prod 실측: 상담이력 있는(=고객이 실제 상담받은) 단건 직접결제 net ₩6.9M / 145행이
--   check_in_id 미결선(未結線)으로 실장 실적에서 소실. pkg_rev 가 07-17 View B 에서
--   check_ins.package_id 의존을 버리고 customer→consultant 최근접 귀속으로 회수한 것과
--   동일한 구조붕괴 → 동일 해법(고객기반 귀속)으로 통일.
--
-- ─── BINDING (DA 조건, 준수 필수) ────────────────────────────────────────────────
--   BINDING-1 (WHO byte-동일): 단건의 고객기반 폴백 = pkg_attr 와 동일 로직(동일 고객의
--     ticketed 상담 中 결제시각 直前 최근접 1건 consultant_id, 동일 ORDER BY tie-break).
--     귀속 조인 소스 = foot-derived ticketed(상담) 에서만 출발(이중계상 급소가드 자동충족).
--     → 같은 고객의 pkg/single 이 서로 다른 heuristic 으로 갈리지 않음.
--   BINDING-2 (과귀속 금지): 결정적 링크(check_in_id→ticketed 상담)는 fact 로 우선 귀속(불변).
--     결정적 링크 無 단건은 고객의 상담이력이 있을 때만 귀속. 상담이력 전무 고객의 단건은
--     귀속 불가 = 제외(NULL 유지). heuristic-launder(임의·강제 귀속) 금지(DA-0718 Q4 계승).
--   BINDING-3 (read-path 우선): write-path(영수증 수납/업로드 단건이 check_in_id 채우기)는
--     후속 하드닝 · 비선행. 본 마이그는 RPC read-time 귀속 통일만.
--   BINDING-4 (회귀 0): check_in_id 가 상담(ticketed) 체크인을 정상 결선한 기존 단건은
--     single_direct 가 동일 consultant 로 귀속(옛 조인과 byte-동일) + single_cust 에서 배제.
--     → 정상 결선 단건 결과 완전 불변. 신 로직은 미결선 단건에 대해 '추가 회수'만 수행(가산적).
--
-- ─── 귀속 파이프라인 (단건 1건당 정확히 1회 or 미귀속) ──────────────────────────────
--   payment_base : 기간 accounting_date 윈도우 단건 + 고객해석(customer_id, 없으면 check_in→customer)
--                  + net(refund=음수). WHEN(인식축)=accounting_date 불변.
--   single_direct: (a) 결정적 링크 = check_in_id→ticketed 상담 consultant. 옛 single_rev 와 동일. (불변/fact)
--   single_cust  : (b) 폴백 = 결정적 링크 없는 단건만, 고객기반 최근접 귀속(pkg_attr byte-동형).
--                  상담이력 無 → 미매칭 → 자연 제외(NULL 유지).
--   single_attr  : (a) ∪ (b) — 상호 배타(single_cust 는 NOT IN single_direct) → 이중카운트 0.
--   single_rev   : single_attr 귀속 consultant 별 net 합.
--
-- ─── grain / 불변 보존 ──────────────────────────────────────────────────────────
--   반환형 7컬럼 불변(consultant_id/name/ticketing_count/package_count/avg_amount/total_amount/
--     consulted_customer_count) → CREATE OR REPLACE(DROP 불요, 42P13 없음).
--   pkg_rev/pkg_conv/consulted_cust/avg_amount 산식/ticketing_count/roster union = 전부 불변.
--   변경점은 오직 single_rev 산출 파이프라인(check_in_id 단일경로 → 결정적+고객기반 이중경로).
--   dual-axis grain(분자 accounting_date / 분모 checked_in_at) 의도된 설계 유지.
--
-- ─── 안전성 (게이트: autonomy §3.1 대표게이트 면제, supervisor 검증만) ───────────────
--   테이블/데이터/enum/컬럼 write 0 = ADDITIVE/비파괴/read-path. MIG-GATE 비유발. db_change=false.
--   STABLE / SECURITY INVOKER / SET search_path=public (anon 차단, authenticated only).
--   시맨틱-값 변화: single_rev 총매출 +₩6.9M/145행 회수(정상=버그수정). 정상결선 단건 불변(회귀 0).
-- ============================================================

BEGIN;

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
  -- BINDING-1: 실제 풋 상담(consultant_id NOT NULL + to_status='consultation')만.
  -- 기간 필터 O = ticketing_count(활동, checked_in_at 축) + 객단가 분모(distinct 상담고객)용. (불변)
  ticketed AS (
    SELECT DISTINCT
      ci.id          AS check_in_id,
      ci.consultant_id,
      ci.customer_id
    FROM check_ins ci
    JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.consultant_id IS NOT NULL
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
      AND st.to_status = 'consultation'
  ),
  -- 동일 정의이나 ★기간 무필터(전기간) — WHO(귀속) 재구성용. 판매상담사는 언제 상담했든 그 사람. (불변)
  ticketed_all AS (
    SELECT DISTINCT
      ci.id AS check_in_id,
      ci.consultant_id,
      ci.customer_id,
      ci.checked_in_at
    FROM check_ins ci
    JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.consultant_id IS NOT NULL
      AND st.to_status = 'consultation'
  ),
  -- WHO(pkg): 각 패키지 → 동일 고객의 ticketed 상담 中 created_at 直前 최근접 1건의 consultant_id.
  --   DISTINCT ON(p.id)=패키지당 1회. check_ins.package_id 미참조. (불변 — 본 티켓의 재사용 SSOT)
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
  -- WHEN(pkg): 패키지매출 = package_payments 中 accounting_date ∈ 기간 (net). 귀속 = pkg_attr. (불변)
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
  -- Q4: 전환 = 기간 accounting_date 에 payment 존재 DISTINCT 귀속패키지 수(분납 방지). (불변)
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
  -- ─── single_rev WHO 재설계 (T-20260724-...SINGLEPAY-ATTR-FIX) ──────────────────
  -- payment_base: 기간 accounting_date 윈도우 단건 + 고객해석 + net. (WHEN=accounting_date 불변)
  --   고객해석 = COALESCE(payments.customer_id, check_ins.customer_id) — 단건 자체 고객 우선,
  --   없으면 결선된 체크인의 고객. 둘 다 NULL 이면 고객미상 → 폴백 귀속 불가(제외).
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
  -- (a) 결정적 링크(fact, 회귀 0): check_in_id → ticketed 상담 consultant. 옛 single_rev 조인과 동일.
  --   ticketed_all 은 check_in 당 1행 → 단건당 최대 1행(DISTINCT ON=방어적 결정성 tie-break).
  single_direct AS (
    SELECT DISTINCT ON (pb.payment_id)
      pb.payment_id,
      ta.consultant_id
    FROM payment_base pb
    JOIN ticketed_all ta ON ta.check_in_id = pb.check_in_id
    ORDER BY pb.payment_id, ta.check_in_id
  ),
  -- (b) 고객기반 폴백 = pkg_attr byte-동형. 결정적 링크 없는 단건만. 상담이력 無 → 미매칭 제외(과귀속 금지).
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
  -- (a) ∪ (b) — 상호 배타(single_cust NOT IN single_direct) → 단건당 정확히 1회 or 미귀속. 이중카운트 0.
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
  -- ticketing_count: 정의 불변(기간 checked_in_at 축, DISTINCT ticketed check_in).
  tk_count AS (
    SELECT t.consultant_id, COUNT(DISTINCT t.check_in_id)::int AS ticketing_count
    FROM ticketed t
    GROUP BY t.consultant_id
  ),
  -- AC6 객단가 분모: 실장별 distinct 상담(내원)고객 수 (기간 checked_in_at 축). (불변)
  consulted_cust AS (
    SELECT t.consultant_id, COUNT(DISTINCT t.customer_id)::int AS consulted_customer_count
    FROM ticketed t
    GROUP BY t.consultant_id
  ),
  -- 로스터: 기간 티켓팅 상담사 ∪ 기간 매출귀속 상담사 (AC4 대사 불변식 보호). (불변)
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
    ROUND(
      (COALESCE(pr.rev, 0) + COALESCE(sr.rev, 0))::numeric
      / NULLIF(COALESCE(cc.consulted_customer_count, 0), 0)
    )::bigint                                                           AS avg_amount,
    (COALESCE(pr.rev, 0) + COALESCE(sr.rev, 0))::bigint                 AS total_amount,
    COALESCE(cc.consulted_customer_count, 0)                           AS consulted_customer_count
  FROM staff s
  JOIN consultant_universe cu ON cu.consultant_id = s.id
  LEFT JOIN tk_count       tk ON tk.consultant_id = s.id
  LEFT JOIN pkg_rev        pr ON pr.consultant_id = s.id
  LEFT JOIN pkg_conv       pc ON pc.consultant_id = s.id
  LEFT JOIN single_rev     sr ON sr.consultant_id = s.id
  LEFT JOIN consulted_cust cc ON cc.consultant_id = s.id
  WHERE s.clinic_id = p_clinic_id
    AND s.role = 'consultant'
  GROUP BY s.id, s.name, tk.ticketing_count, pc.package_count, pr.rev, sr.rev, cc.consulted_customer_count
  ORDER BY ticketing_count DESC, avg_amount DESC NULLS LAST;
$$;

-- 권한 멱등 보강 (CREATE OR REPLACE 는 기존 GRANT 유지)
REVOKE ALL ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE)
  IS 'foot-stats: 상담실장 실적(총매출/객단가/전환/상담고객수). single_rev(단건결제) WHO 귀속을 pkg_rev customer→consultant(pkg_attr) 와 byte-동형화 — 결정적 링크(check_in_id→ticketed 상담)=fact 우선(회귀0) + 고객기반 최근접 폴백(pkg_attr 동형)으로 미결선 단건 회수, 상담이력 無 단건은 미귀속(NULL) 유지(과귀속 금지). 분자(total_amount)=accounting_date net, WHO=전기간 최근접. avg_amount 분모=distinct 상담고객수(불변). ADDITIVE/read-path/no-DDL-data-mutation. T-20260724-foot-CONSULTANT-TKTREV-SINGLEPAY-ATTR-FIX / DA-20260724-FOOTDOSU-STATS-REGCOUNSELOR-WHO-CANON.';

COMMIT;
