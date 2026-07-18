-- ============================================================
-- ORPHAN CREDIT FREEZE + COUNT REPORT (READ-ONLY) — data lane
-- T-20260715-foot-PKG-CREDIT-ORPHAN-REANCHOR-BACKFILL (data-lane)
--   부모(구조 lane): T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK (package_credit_ledger 신설)
--   조부모(즉시피해 정정): T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR (Part1 freeze 2건)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-07-15 · 백필 data-lane 확정: 2026-07-18
-- ============================================================
-- 목적: 과거 패키지 취소·재생성으로 옛(폐기) 패키지에 고아로 남은 credit 을 전수 산출(freeze)하고,
--       현 활성 패키지로의 re-anchor 후보를 건별 probe 한다. 실제 re-anchor 실행은
--       package_credit_ledger 로의 append(charge tx) 이며 supervisor data-diff 게이트 후에만.
--
--   ⚠ 본 파일은 READ-ONLY(SELECT 만). UPDATE/DELETE/INSERT 없음.
--   ⚠ 실제 count 는 prod 조회 → supervisor data-diff 게이트에서 실행(dev-foot 는 술어만 freeze).
--   ⚠ 백필 방식 = re-anchor(연결 복원 = ledger charge tx append), archive-delete/blanket-UPDATE 아님.
--   ⚠ SOP = data_correction_backfill_sop(대상셋 freeze + 지문 + 판정근거 스냅샷 + 폴백 + 원장 무접점)
--          + orphan_row_archive_first_cleanup(고아행 정정 안전봉투: freeze셋 재검증 abort·순소실0).
--   ⚠ 단일 count 기준 blanket UPDATE 절대금지 — 건별 probe 후 auto_candidate 만 ledger charge tx re-anchor.
-- 순서: 구조(FK+ledger+supersede) 선착지(deployed) → 백필은 그 위로(§10-7 동형).
-- ============================================================

-- ------------------------------------------------------------
-- ★ 조부모 Part1 freeze 2건 — 이중정정 방지 제외셋 (AC1)
--   조부모 RECUR Part1(현장 승인 apply 완료)이 F-4716·F-4666 의 "현 활성 패키지 paid_amount" 를
--   이미 재정합(re-anchor)함. 그 활성 패키지들을 본 백필 re-anchor 대상으로 다시 잡으면 이중정정.
--   → reanchor_target 이 아래 활성 pkg 인 고아 건은 freeze셋에서 제외하고, 교집합 0 을 검증(섹션 C).
--   ⚠ prefix(8자)로 고정. supervisor 는 실행 전 prod 에서 full-UUID 로 확정·치환(F-4716=내성체험권,
--     F-4666=무좀체험권 활성 pkg). prefix 다중매칭이면 abort 하고 full-UUID 확정.
-- ------------------------------------------------------------
-- 조부모 Part1 재정합 활성 pkg:
--   F-4716 김희정 / 내성체험권 / 59,000 / pkg id LIKE '3f4d3ec6%'
--   F-4666 김지민 / 무좀체험권 / 10,000 / pkg id LIKE '5ed60da7%'

-- ------------------------------------------------------------
-- 공통 술어(freeze predicate): 고아 credit 후보
--   = 재생성/폐기된 원본 패키지(status IN cancelled/refunded)에
--     실납부 credit 이 남아 있고(net package_payments > 0 또는 paid_amount 캐시 > 0),
--     후속으로 승계된 계보(superseded_by)가 없어 credit 이 stranded 된 행.
--   판정근거(지문): net_pp(원장근거) vs paid_amount(캐시근거) 를 둘 다 노출.
--     둘이 어긋나면(credit 근거 불일치) auto 금지 → 사람 판정(폴백).
-- ------------------------------------------------------------

-- ============================================================
-- (A) 규모 count + 금액 합 (조부모 freeze 2건 제외)
-- ============================================================
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
    GREATEST(net_pp, COALESCE(paid_amount, 0)) AS credit_won,
    -- 근거 일치 여부(지문): 원장 net_pp 와 캐시 paid_amount 동액이면 근거 견고
    (net_pp = COALESCE(paid_amount, 0))        AS credit_basis_agree
  FROM pkg_paid
  WHERE status IN ('cancelled', 'refunded')             -- 재생성으로 폐기된 원본
    AND GREATEST(net_pp, COALESCE(paid_amount, 0)) > 0   -- 실 납부 credit 존재
    AND superseded_by IS NULL                            -- 승계 계보 없음 → 고아
),
active_cand AS (  -- 동일 고객의 현행 활성 패키지(re-anchor 후보). superseded_by lineage 최종본 우선, 없으면 최신 active.
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
  COUNT(*)                                          AS orphan_credit_count,
  SUM(o.credit_won)                                 AS orphan_credit_won_total,
  COUNT(*) FILTER (WHERE ac.active_pkg_count = 1
                     AND o.credit_basis_agree)      AS auto_candidate_count,
  COUNT(*) FILTER (WHERE NOT (ac.active_pkg_count = 1
                     AND o.credit_basis_agree))     AS hold_escalate_count,
  MIN(o.contract_date)                              AS earliest,
  MAX(o.contract_date)                              AS latest
FROM orphan o
LEFT JOIN active_cand ac ON ac.orphan_id = o.id
-- 조부모 Part1 freeze 2건(이미 정정된 활성 pkg 로의 re-anchor) 제외
WHERE ac.newest_active_pkg::text NOT LIKE '3f4d3ec6%'
  AND ac.newest_active_pkg::text NOT LIKE '5ed60da7%';

-- ============================================================
-- (B) 건별 freeze 리스트 + re-anchor probe 힌트 + 판정근거 스냅샷
--   supervisor 는 이 스냅샷을 freeze VALUES 로 고정(캡처)한 뒤,
--   probe_verdict='auto_candidate' 건만 backfill.apply 로 건별 ledger charge tx re-anchor.
--   나머지('hold_*')는 폴백 큐(현장 김주연 총괄 확인) 로 분리 — 본 batch 미포함.
-- ============================================================
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
    GREATEST(net_pp, COALESCE(paid_amount, 0)) AS credit_won,
    (net_pp = COALESCE(paid_amount, 0))        AS credit_basis_agree
  FROM pkg_paid
  WHERE status IN ('cancelled', 'refunded')
    AND GREATEST(net_pp, COALESCE(paid_amount, 0)) > 0
    AND superseded_by IS NULL
),
active_cand AS (
  SELECT o.id AS orphan_id,
         COUNT(ap.id) AS active_pkg_count,
         (ARRAY_AGG(ap.id ORDER BY ap.created_at DESC))[1] AS newest_active_pkg
  FROM orphan o
  LEFT JOIN public.packages ap
    ON ap.customer_id = o.customer_id
   AND ap.status = 'active'
   AND ap.id <> o.id
  GROUP BY o.id
),
already AS (  -- 이미 re-anchor 된 고아(idempotency: 재실행 시 중복 append 방지)
  SELECT DISTINCT reanchored_from AS orphan_id
  FROM public.package_credit_ledger
  WHERE reanchored_from IS NOT NULL
)
SELECT
  o.id                AS orphan_package_id,
  o.customer_id,
  o.clinic_id,
  o.package_name,
  o.status,
  o.net_pp            AS credit_basis_ledger,   -- 원장(package_payments) 근거
  o.paid_amount       AS credit_basis_cache,    -- 캐시(paid_amount) 근거
  o.credit_basis_agree,
  o.credit_won,                                 -- re-anchor 할 금액(보수적 최대)
  o.contract_date,
  o.created_at,
  ac.active_pkg_count,
  ac.newest_active_pkg AS reanchor_candidate,
  (al.orphan_id IS NOT NULL) AS already_reanchored,
  CASE
    WHEN al.orphan_id IS NOT NULL                             THEN 'skip_already_reanchored'
    -- 조부모 Part1 freeze 2건(이미 정정된 활성 pkg) → 이중정정 방지
    WHEN ac.newest_active_pkg::text LIKE '3f4d3ec6%'
      OR ac.newest_active_pkg::text LIKE '5ed60da7%'          THEN 'skip_grandparent_part1'
    WHEN NOT o.credit_basis_agree                             THEN 'hold_credit_basis_divergent' -- 근거 불일치 → 사람 판정
    WHEN ac.active_pkg_count = 1                              THEN 'auto_candidate'    -- 활성 후보 1개 + 근거 일치 → 유력 re-anchor 대상
    WHEN ac.active_pkg_count = 0                              THEN 'hold_no_active'     -- 활성 없음 → 사람 판정(환불/휴면?)
    ELSE                                                           'hold_ambiguous'     -- 활성 2+ → 사람 판정
  END AS probe_verdict
FROM orphan o
LEFT JOIN active_cand ac ON ac.orphan_id = o.id
LEFT JOIN already al      ON al.orphan_id = o.id
ORDER BY o.credit_won DESC;

-- ============================================================
-- (C) ★ 조부모 Part1 freeze 2건 교집합 검증 (AC1) — 기대값 0
--   auto_candidate 로 잡히는 고아의 reanchor_candidate 가 조부모 Part1 재정합 활성 pkg 와
--   교집합이 0 임을 명시 검증. 0 이 아니면 이중정정 위험 → apply 중단(사람 판정).
-- ============================================================
WITH pkg_paid AS (
  SELECT p.id, p.customer_id, p.status, p.superseded_by, p.paid_amount,
    COALESCE(SUM(CASE WHEN pp.payment_type='payment' THEN pp.amount
                      WHEN pp.payment_type='refund'  THEN -pp.amount END),0) AS net_pp
  FROM public.packages p
  LEFT JOIN public.package_payments pp ON pp.package_id = p.id
  GROUP BY p.id
),
orphan AS (
  SELECT id, customer_id FROM pkg_paid
  WHERE status IN ('cancelled','refunded')
    AND GREATEST(net_pp, COALESCE(paid_amount,0)) > 0
    AND superseded_by IS NULL
),
active_cand AS (
  SELECT o.id AS orphan_id,
         (ARRAY_AGG(ap.id ORDER BY ap.created_at DESC))[1] AS newest_active_pkg
  FROM orphan o
  LEFT JOIN public.packages ap
    ON ap.customer_id = o.customer_id AND ap.status='active' AND ap.id <> o.id
  GROUP BY o.id
)
SELECT
  COUNT(*) FILTER (
    WHERE newest_active_pkg::text LIKE '3f4d3ec6%'
       OR newest_active_pkg::text LIKE '5ed60da7%'
  ) AS grandparent_part1_intersection   -- 기대: 0
FROM active_cand;

-- ============================================================
-- 제출 절차(supervisor data-diff 게이트)
-- ------------------------------------------------------------
-- 1. 구조 마이그(20260715190000_...fklink.sql) prod 적용(deployed) 확인 후 본 report 를 prod 에서 (A)(B)(C) 실행.
-- 2. (C) 교집합 = 0 확인(AC1). ≠0 이면 full-UUID 재확정 후에도 0 아니면 apply 중단·사람 판정.
-- 3. (A) count/합 + (B) 건별 리스트를 freeze VALUES 로 캡처(판정근거 스냅샷 동봉).
-- 4. probe_verdict='auto_candidate' 건만 20260715191000_foot_pkg_orphan_credit_reanchor.backfill.sql 의
--    _orphan_freeze VALUES 로 붙여넣고 dry-run(무영속) → data-diff 대조 → GO 후 apply.
--    'hold_*' / 'skip_*' 건은 apply 미포함 — hold 는 폴백(현장 확인 큐), skip 은 재실행 idempotency.
-- 5. apply 후 postverify: 각 auto 건 Σledger(reanchor_candidate) == credit_won, payments/package_payments 무접점.
-- ============================================================
