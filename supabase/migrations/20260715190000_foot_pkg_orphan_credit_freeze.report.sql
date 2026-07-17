-- ============================================================
-- ORPHAN CREDIT FREEZE + COUNT REPORT (READ-ONLY) — data lane
-- T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK 백필 선행 산출물
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-07-15
-- ============================================================
-- 목적: DA CONSULT-REPLY Q3 — "잔존분 규모 미상 → dev-foot 술어 freeze→count 산출 제출 후 범위 확정"
--   ⚠ 본 파일은 READ-ONLY(SELECT 만). UPDATE/DELETE/INSERT 없음.
--   ⚠ 실제 count 는 prod 조회 → supervisor data-diff 게이트에서 실행(dev-foot 는 술어만 freeze).
--   ⚠ 백필 방식 = re-anchor(연결 복원), archive-delete 아님. SOP=data_correction_backfill_sop.
--   ⚠ 단일 count 기준 blanket UPDATE 금지 — 건별 probe 후 ledger charge tx 로 re-anchor.
-- 순서: 구조(FK+ledger+supersede) 선착지 → 백필은 그 위로(§10-7 동형).
-- ============================================================

-- ------------------------------------------------------------
-- 술어(freeze predicate): 고아 credit 후보
--   = 재생성/폐기된 원본 패키지(status IN cancelled/refunded)에
--     실납부 credit(net package_payments > 0)이 남아 있고,
--     후속으로 승계된 계보(superseded_by)가 없어 credit 이 stranded 된 행.
-- ------------------------------------------------------------
-- (A) 규모 count + 금액 합
WITH pkg_paid AS (
  SELECT
    p.id, p.customer_id, p.clinic_id, p.status, p.package_name,
    p.total_amount, p.paid_amount, p.superseded_by, p.contract_date, p.created_at,
    COALESCE(SUM(CASE WHEN pp.payment_type = 'payment' THEN pp.amount
                      WHEN pp.payment_type = 'refund'  THEN -pp.amount END), 0) AS net_pp
  FROM public.packages p
  LEFT JOIN public.package_payments pp ON pp.package_id = p.id
  GROUP BY p.id
),
orphan AS (
  SELECT *,
    -- credit = 실납부 근거의 보수적 최대(net package_payments vs paid_amount 캐시)
    GREATEST(net_pp, COALESCE(paid_amount, 0)) AS credit_won
  FROM pkg_paid
  WHERE status IN ('cancelled', 'refunded')     -- 재생성으로 폐기된 원본
    AND GREATEST(net_pp, COALESCE(paid_amount, 0)) > 0   -- 실 납부 credit 존재
    AND superseded_by IS NULL                   -- 승계 계보 없음 → 고아
)
SELECT
  COUNT(*)            AS orphan_credit_count,
  SUM(credit_won)     AS orphan_credit_won_total,
  MIN(contract_date)  AS earliest,
  MAX(contract_date)  AS latest
FROM orphan;

-- ------------------------------------------------------------
-- (B) 건별 freeze 리스트 + re-anchor probe 힌트
--   각 고아 행에 대해: 동일 고객의 (1) 현행 활성 패키지, (2) 최근 체크인 패키지 를 후보로 제시.
--   모호(활성 후보 2+ 또는 0)한 건은 에스컬레이션 → 사람 판정.
--   supervisor 는 이 스냅샷을 freeze VALUES 로 고정한 뒤 건별 ledger charge tx 로 re-anchor.
-- ------------------------------------------------------------
WITH pkg_paid AS (
  SELECT
    p.id, p.customer_id, p.clinic_id, p.status, p.package_name,
    p.paid_amount, p.superseded_by, p.contract_date, p.created_at,
    COALESCE(SUM(CASE WHEN pp.payment_type = 'payment' THEN pp.amount
                      WHEN pp.payment_type = 'refund'  THEN -pp.amount END), 0) AS net_pp
  FROM public.packages p
  LEFT JOIN public.package_payments pp ON pp.package_id = p.id
  GROUP BY p.id
),
orphan AS (
  SELECT *, GREATEST(net_pp, COALESCE(paid_amount, 0)) AS credit_won
  FROM pkg_paid
  WHERE status IN ('cancelled', 'refunded')
    AND GREATEST(net_pp, COALESCE(paid_amount, 0)) > 0
    AND superseded_by IS NULL
),
active_cand AS (  -- 동일 고객의 현행 활성 패키지(re-anchor 후보)
  SELECT o.id AS orphan_id,
         COUNT(ap.id) AS active_pkg_count,
         (ARRAY_AGG(ap.id ORDER BY ap.created_at DESC))[1] AS newest_active_pkg
  FROM orphan o
  LEFT JOIN public.packages ap
    ON ap.customer_id = o.customer_id
   AND ap.status = 'active'
   AND ap.id <> o.id
  GROUP BY o.id
)
SELECT
  o.id                AS orphan_package_id,
  o.customer_id,
  o.clinic_id,
  o.package_name,
  o.status,
  o.credit_won,
  o.contract_date,
  o.created_at,
  ac.active_pkg_count,
  ac.newest_active_pkg AS reanchor_candidate,
  CASE
    WHEN ac.active_pkg_count = 1 THEN 'auto_candidate'   -- 활성 후보 1개 → 유력 re-anchor 대상
    WHEN ac.active_pkg_count = 0 THEN 'escalate_no_active'-- 활성 없음 → 사람 판정(환불/휴면?)
    ELSE 'escalate_ambiguous'                             -- 활성 2+ → 사람 판정
  END AS probe_verdict
FROM orphan o
LEFT JOIN active_cand ac ON ac.orphan_id = o.id
ORDER BY o.credit_won DESC;

-- ============================================================
-- 제출 절차(supervisor data-diff 게이트)
-- ------------------------------------------------------------
-- 1. 구조 마이그(20260715190000_...fklink.sql) 적용 확인 후 본 report 를 prod 에서 (A)(B) 실행.
-- 2. (A) count/합 + (B) 건별 리스트를 freeze VALUES 로 캡처(스냅샷 동봉).
-- 3. probe_verdict='auto_candidate' 건 → ledger charge tx 로 re-anchor(dry-run count + rollback SQL 동반).
--    'escalate_*' 건 → 사람 판정(현장/planner) 후 개별 처리. blanket UPDATE 금지.
-- 4. 부모 티켓 Part1 freeze 2건은 (B) 리스트에 포함되는지 대조 후 즉시 정정.
-- ============================================================
