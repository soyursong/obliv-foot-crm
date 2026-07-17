-- ============================================================
-- T-20260717-foot-CONSULTANT-ARPU-STATS  (AC6)
-- foot_stats_consultant 객단가(avg_amount) 분모 = "상담(내원)고객 distinct" 로 pin
--   + consulted_customer_count 신규 ADDITIVE 컬럼 노출.
--   DA-20260717-FOOT-CONSULTANT-ARPU-AC6 GO(ADDITIVE) — CONSULT-REPLY 그대로 구현.
-- Base : commit 012415e6 / 20260717160000_foot_stats_consultant_pkg_attr_reconstruct (권고안 A).
--        numerator(total_amount)·pkg_attr WHO 로직 동일소스 재사용 → drift 0.
-- DB   : rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성 : dev-foot / 2026-07-17
-- 롤백 : 20260717170000_foot_stats_consultant_arpu_consulted_denom.rollback.sql (= 6-col base 복원)
-- dry-run: 20260717170000_foot_stats_consultant_arpu_consulted_denom.dryrun.mjs
-- 표준 : Migration Ledger Reconciliation / Migration Dry-Run No-Persistence Protocol
--
-- ─── ① population-pin (BINDING, DA §①) ─────────────────────────────────────────
--   분모(객단가) = 해당 실장이 상담(내원)한 distinct 고객
--     = COUNT(DISTINCT customer_id) FROM ticketed (to_status='consultation'
--       AND consultant_id NOT NULL) WHERE consultant_id=실장 AND checked_in_at ∈ [from,to].
--   · "예약만"(미내원) 제외 / "노쇼" 제외 / 상담완료(내원) 포함.
--   · distinct 고객(상담'건수' 아님). 윈도 내 동일고객 2회 상담 → 분모 1.
--   · 결제여부 무관 (미결제 상담고객도 분모 포함 → ARPU 하향, 김주연 총괄 확정 · 현장 인지).
--
-- ─── ② 반환형 (BINDING, DA §②) ─────────────────────────────────────────────────
--   · 신규 arpu 병렬컬럼 만들지 않음. avg_amount(사이드바 '객단가')를 in-place 재정의.
--     └ reconcile base 가 avg_amount 분모를 "미확정"으로 남긴 in-flight 항목 → 완성이지 재정의 아님.
--   · consulted_customer_count(INT, distinct 상담고객) 신규 ADDITIVE 컬럼(필수) — A6/AC4 대사 감사
--     + FE 가 분모를 역산 없이 표시("N명 상담·객단가 X").
--   · 분자(total_amount) 불변 → three-way byte-정합(객단가 분자 == 인센티브 분모 base == 화면 매출컬럼) 보존.
--   · 반환형 7컬럼 = (consultant_id, name, ticketing_count, package_count, avg_amount,
--     total_amount, consulted_customer_count).
--   · DDL 성격 = 컬럼 1개 추가(반환형 변경) → DROP FUNCTION IF EXISTS + CREATE(단일 txn, 멱등, 42P13 회피).
--     ★ 여전히 ADDITIVE: 컬럼 제거·타입변경·데이터/테이블 mutation·PHI 없음. 롤백=6-col base 함수본문 복원.
--     → CEO 게이트 면제 유지, supervisor DDL-diff 만(반환형 DROP+CREATE=signature 변경임을 명시).
--
-- ─── ③ 산식 원문 (DA §③, dev 추정 금지 — 그대로) ────────────────────────────────
--   avg_amount = total_amount / NULLIF(distinct 상담고객수, 0)   -- 분모=0 → NULL('-' 표시)
--   분자 = 해당 실장 귀속 net 수납매출 (= MGRSTAT canonical total_amount, 재집계 금지)
--          · net(refund=음수) · accounting_date ∈ [from,to] · 공단부담/선수금 제외 · source-agnostic
--   분모 = COUNT(DISTINCT customer_id) among ticketed WHERE consultant_id=실장
--          AND checked_in_at ∈ [from,to] · 결제여부 무관
--   ★ dual-axis grain (MUST-DOCUMENT): 분자 = accounting_date(매출인식축)
--     · 분모 = checked_in_at(활동축). 서로 다른 시간축 공존은 reconcile Q3 확정
--     (total_amount(accounting_date) ↔ ticketing_count(checked_in_at))과 동일 설계.
--     기간경계 "6/30 상담·7/1 결제" 고객은 6월 분모·7월 분자로 갈릴 수 있으나 의도된 grain(결함 아님).
--
-- ─── ④ 잔차정합 (DA §④, BINDING-3 계승) ────────────────────────────────────────
--   분자·분모가 동일 ticketed 집합에서 파생 → 귀속불가 행은 양쪽에서 동시 제외(대칭 배제)
--   → ARPU 팽창·수축 없음. 강제귀속 금지(잔차를 임의 실장에 귀속 절대 금지, NULL-미귀속 유지).
--   의도된 비대칭 1건: 상담(ticketed)했으나 미결제 → 분모 포함·분자 0 → ARPU 하향(본래 의미).
--   잔차 계측은 dry-run 이 수행(silent leak 차단).
--
-- ─── ticketing_count / total_amount / package_count = 불변(정의·값 유지) ────────
--   ticketing_count = checked_in_at 활동축(불변). total_amount·package_count·WHO 귀속 = base 그대로.
--   변경점은 오직 (a) avg_amount 분모 = ticketing_count → consulted_customer_count,
--             (b) consulted_customer_count 컬럼 노출.  나머지 회귀 0.
--
-- ─── 안전성 (게이트: CEO 면제, supervisor DDL-diff) ────────────────────────────
--   STABLE / SECURITY INVOKER / SET search_path=public (anon 차단, authenticated only).
-- ============================================================

BEGIN;

-- 반환형 변경(6→7컬럼) → DROP 필수(42P13 회피). IF EXISTS = 멱등.
DROP FUNCTION IF EXISTS public.foot_stats_consultant(UUID, DATE, DATE);

CREATE FUNCTION public.foot_stats_consultant(
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
  consulted_customer_count INT      -- ★ 신규 ADDITIVE: distinct 상담(내원)고객 수(객단가 분모)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  -- BINDING-1: 실제 풋 상담(consultant_id NOT NULL + to_status='consultation')만.
  -- 기간 필터 O = ticketing_count(활동, checked_in_at 축) + 객단가 분모(distinct 상담고객)용.
  -- ★ customer_id 추가 = 상담고객 distinct count 분모 산출용(AC6). check_in 은 고객 1:1.
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
  -- 동일 정의이나 ★기간 무필터(전기간) — WHO(귀속) 재구성용. 판매상담사는 언제 상담했든 그 사람.
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
  -- WHO: 각 패키지 → 동일 고객의 ticketed 상담 中 created_at 直前 최근접 1건의 consultant_id.
  --   DISTINCT ON(p.id)=패키지당 1회. check_ins.package_id 미참조(구조붕괴 경로 완전 제거). (base 동일)
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
  -- WHEN: 패키지매출 = package_payments 中 accounting_date ∈ 기간 (net). 귀속 = pkg_attr. (분자, 불변)
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
  -- 단건결제(payments): accounting_date 윈도잉 + ticketed check_in 의 consultant 귀속(net). (분자, 불변)
  single_rev AS (
    SELECT
      ta.consultant_id,
      SUM(CASE WHEN pay.payment_type = 'refund' THEN -pay.amount ELSE pay.amount END)::bigint AS rev
    FROM payments pay
    JOIN ticketed_all ta ON ta.check_in_id = pay.check_in_id
    WHERE pay.clinic_id = p_clinic_id
      AND pay.accounting_date BETWEEN p_from AND p_to
    GROUP BY ta.consultant_id
  ),
  -- ticketing_count: 정의 불변(기간 checked_in_at 축, DISTINCT ticketed check_in).
  tk_count AS (
    SELECT t.consultant_id, COUNT(DISTINCT t.check_in_id)::int AS ticketing_count
    FROM ticketed t
    GROUP BY t.consultant_id
  ),
  -- ★ AC6 객단가 분모: 실장별 distinct 상담(내원)고객 수 (기간 checked_in_at 축).
  --   상담'건수'(ticketing_count) 아님 — 동일고객 다회 상담은 1. 결제여부 무관.
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
    -- ★ AC6 산식 원문: avg_amount = total_amount / NULLIF(distinct 상담고객수, 0).
    --   분모=0(매출귀속만·기간상담 0) → NULL('-' 표시). dual-axis: 분자 accounting_date / 분모 checked_in_at.
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

-- 권한 (DROP+CREATE 는 GRANT 소실 → 재부여 필수)
REVOKE ALL ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE)
  IS 'foot-stats: 상담실장 실적(총매출/객단가/전환/상담고객수). AC6(T-20260717-foot-CONSULTANT-ARPU-STATS): 객단가(avg_amount) 분모 = distinct 상담(내원)고객수(consulted_customer_count, checked_in_at 활동축·결제무관·노쇼/예약only 제외) 로 pin. 분자(total_amount) 불변=accounting_date net 귀속(권고안 A WHO/WHEN). dual-axis grain(분자 accounting_date / 분모 checked_in_at) 의도된 설계. avg_amount 분모=0 → NULL. consulted_customer_count 신규 ADDITIVE. DA-20260717-FOOT-CONSULTANT-ARPU-AC6.';

COMMIT;
