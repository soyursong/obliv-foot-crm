-- ============================================================
-- T-20260717-foot-DAYCLOSE-VS-SIDEBAR-MGRSTAT-RECONCILE
-- foot_stats_consultant 실장별 총매출/객단가/전환율 구조붕괴 근본 재설계.
--   권고안 A(RPC-only 시간정렬 재구성) — DA-20260717-FOOT-CONSULTANT-PKG-ATTR-RECONCILE GO(ADDITIVE).
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성: dev-foot / 2026-07-17
-- 롤백: 20260717160000_foot_stats_consultant_pkg_attr_reconstruct.rollback.sql
-- dry-run: 20260717160000_foot_stats_consultant_pkg_attr_reconstruct.dryrun.mjs (AC4 대사 불변식 재현대조)
-- 표준: Migration Ledger Reconciliation / Migration Dry-Run No-Persistence Protocol
--
-- ─── 왜 재설계인가 (구조붕괴 RC) ────────────────────────────────────────────────
--   구 RPC(20260622210000)는 패키지매출 귀속을 `check_ins.package_id` 에 의존한다.
--   그러나 이 컬럼은 write-path 의미가 "이 체크인에서 *생성*된 패키지"(운영 mutable)이지
--   "매출 귀속 키"가 아니다 → 재구매·이관·시드 패키지는 원리상 세팅 안 됨.
--   prod 실측: check_ins.package_id 174건 中 1건만 set, package_payments = 매출 ~90%.
--   ⇒ 실장별 총매출이 패키지매출(=매출 대부분)을 통째로 누락 = 구조적 붕괴.
--   권고안 A = check_ins.package_id 의존 완전 제거 + 시간정렬 재구성으로 실제 판매상담사 복원.
--
-- ─── 3 BINDING (DA CONSULT-REPLY 필수 반영) ─────────────────────────────────────
--   BINDING-1: 귀속 소스 = check_ins.consultant_id(실제 풋 상담: consultant_id NOT NULL
--     + status_transitions.to_status='consultation')만. packages.created_by 사용 절대 금지
--     (등록자=코디·프론트일 수 있음 ≠ 클로징 실장; T-20260630 t91v conflation 재발 방지).
--     도파민/TM/cue_card owner 자동 스탬프 금지 — 조인 소스는 foot-derived ticketed 에서만
--     출발(이중계상 급소가드 자동충족). 조인 소스 확대 금지.
--   BINDING-2: 매출 인식 기간축 = 결제행 accounting_date(회계 SSOT, foot_stats_revenue/
--     insurance_split/incentive 전부와 동축 → View A↔View B 대사 성립). net(refund=음수, gross 금지).
--     WHO(귀속)/WHEN(인식) 분리:
--       WHO  = 각 패키지를 동일 고객의 ticketed 상담 중 packages.created_at 直前(없으면 最近접)
--              1건의 consultant_id 에 귀속. DISTINCT ON(package_id)=패키지당 1회(이중카운트 방지).
--              ★귀속 조인은 기간 무필터(전기간 최근접) — 판매상담사는 언제 상담했든 그 사람.
--       WHEN = 그 패키지의 package_payments 中 accounting_date ∈ [p_from,p_to] 만 기간 매출로 합산.
--   BINDING-3: 미귀속(전기간 ticketed 상담이력 전무 고객)의 패키지매출은 귀속 불가 = NULL 유지
--     (T-20260630 correct-by-default 계승, 강제귀속=허위귀속 금지). 잔차는 dry-run 이 계측(silent leak 차단).
--
-- ─── Q4 전환건수/전환율 (동일 재설계로 정정 포함) ────────────────────────────────
--   package_count 도 동일 붕괴경로(pkg_flag=check_ins.package_id 의존)를 탔다 → 함께 정정.
--   package_count = 귀속된 DISTINCT 패키지 수(기간 accounting_date 에 payment_type='payment'
--   존재 패키지). ★분납(1패키지 N결제)이 전환율을 부풀리지 않도록 COUNT(DISTINCT package_id).
--
-- ─── grain 주석 (오독 방지) ─────────────────────────────────────────────────────
--   1행 안에서 ticketing_count(=checked_in_at 활동축, 정의 불변) 와 total_amount 의
--   매출분(=accounting_date 인식축)이 서로 다른 시간축으로 공존한다. 이는 의도된 분리
--   (활동 vs 매출인식)다. total_amount ≠ "ticketing_count 사건들의 매출 합"으로 오독 금지.
--   avg_amount = total_amount ÷ ticketing_count (리포터 모델: 객단가 = 매출 ÷ 상담건수, 정의 불변).
--
-- ─── 로스터(출력 행) 확장 — AC4 대사 불변식 보호 ────────────────────────────────
--   구 RPC 는 INNER JOIN ticketed(기간) 로 "기간 티켓팅 실적 있는 상담사"만 출력했다.
--   WHO 가 전기간 최근접이므로, 5월 상담→7월 결제인식 패키지는 7월 티켓팅 0인 상담사에게
--   귀속될 수 있다. 이 상담사를 누락하면 Σ(View B) 가 그만큼 결손 → 잔차로도 안 잡혀 AC4 붕괴.
--   ∴ 출력 로스터 = 기간 티켓팅 상담사 ∪ 기간 매출귀속 상담사(consultant_universe).
--   ticketing_count 정의는 불변(신규행은 0). 매출은 전액 귀속행에 합산되어 대사 성립.
--
-- ─── 안전성 (게이트: §3.1 CEO 면제, supervisor DDL-diff) ────────────────────────
--   반환형 6컬럼 불변(consultant_id/name/ticketing_count/package_count/avg_amount/total_amount)
--   → CREATE OR REPLACE(DROP 불요, 42P13 없음). 테이블/데이터/enum/컬럼 write 0 = ADDITIVE/비파괴.
--   STABLE / SECURITY INVOKER / SET search_path=public (anon 차단, authenticated only).
--   시맨틱-값 변화: 실장별 총매출 <1% → ~100% 점프(정상=버그수정, 김주연 총괄 Opt2 확정).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.foot_stats_consultant(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  consultant_id   UUID,
  name            TEXT,
  ticketing_count INT,
  package_count   INT,
  avg_amount      BIGINT,
  total_amount    BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  -- BINDING-1: 실제 풋 상담(consultant_id NOT NULL + to_status='consultation')만.
  -- 기간 필터 O = ticketing_count(활동 카운트, checked_in_at 축)용. 정의 불변.
  ticketed AS (
    SELECT DISTINCT
      ci.id AS check_in_id,
      ci.consultant_id
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
  --   정렬: (created_at 이전) 우선 → 시간 근접(작은 gap) 우선 → check_in_id 로 결정적 tie-break.
  --   DISTINCT ON(p.id) = 패키지당 1회. check_ins.package_id 미참조(구조붕괴 경로 완전 제거).
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
  -- WHEN: 패키지매출 = package_payments 中 accounting_date ∈ 기간 (net). 귀속 = pkg_attr.
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
  -- Q4: 전환 = 기간 accounting_date 에 payment(정상결제) 존재하는 DISTINCT 귀속패키지 수(분납 방지).
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
  -- 단건결제(payments): accounting_date 윈도잉(View A 동축) + ticketed check_in 의 consultant 귀속(net).
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
  -- 로스터: 기간 티켓팅 상담사 ∪ 기간 매출귀속 상담사 (AC4 대사 불변식 보호).
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
    CASE
      WHEN COALESCE(tk.ticketing_count, 0) > 0
      THEN ROUND(
             (COALESCE(pr.rev, 0) + COALESCE(sr.rev, 0))::numeric
             / tk.ticketing_count
           )::bigint
      ELSE 0
    END                                                                 AS avg_amount,
    (COALESCE(pr.rev, 0) + COALESCE(sr.rev, 0))::bigint                  AS total_amount
  FROM staff s
  JOIN consultant_universe cu ON cu.consultant_id = s.id
  LEFT JOIN tk_count   tk ON tk.consultant_id = s.id
  LEFT JOIN pkg_rev    pr ON pr.consultant_id = s.id
  LEFT JOIN pkg_conv   pc ON pc.consultant_id = s.id
  LEFT JOIN single_rev sr ON sr.consultant_id = s.id
  WHERE s.clinic_id = p_clinic_id
    AND s.role = 'consultant'
  GROUP BY s.id, s.name, tk.ticketing_count, pc.package_count, pr.rev, sr.rev
  ORDER BY ticketing_count DESC, avg_amount DESC;
$$;

-- 권한 멱등 보강 (CREATE OR REPLACE 는 기존 GRANT 유지)
REVOKE ALL ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE)
  IS 'foot-stats: 상담실장 실적(총매출/객단가/전환). 권고안 A 시간정렬 재구성 — 패키지매출 귀속=고객의 ticketed 상담 中 packages.created_at 최근접 consultant_id(check_ins.package_id 미의존). WHO=전기간 최근접 / WHEN=accounting_date∈기간 / net. ticketing_count=checked_in_at 활동축(불변). package_count=DISTINCT 귀속패키지(분납 이중카운트 방지). T-20260717-foot-DAYCLOSE-VS-SIDEBAR-MGRSTAT-RECONCILE / DA-20260717-FOOT-CONSULTANT-PKG-ATTR-RECONCILE';

COMMIT;
