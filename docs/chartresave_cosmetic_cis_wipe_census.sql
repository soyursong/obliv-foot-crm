-- ══════════════════════════════════════════════════════════════════════════════
-- 차트 재저장(check_in_services delete-all→reinsert) retail 화장품 라인 소멸 +
-- 결제-서비스라인 unlink — 영향 규모 census (READ-ONLY)
-- T-20260805-foot-CHARTRESAVE-COSMETIC-CIS-WIPE-PAYUNLINK-DIAG (AC2/AC3)
-- ══════════════════════════════════════════════════════════════════════════════
-- 용도: 재저장으로 화장품(풋화장품) cis 라인이 소멸해 alive 결제행과 unlink 된 규모를
--   환자수·결제건수·금액으로 전수 집계 + 매출 line-item 분해 divergence 판별.
-- 실행: Supabase SQL Editor 또는 psql. **읽기 전용 SELECT — 스키마·데이터 변경 0.**
--
-- ── 인증컨텍스트 (필수 명시, Cross-CRM 진단 인증컨텍스트 표준) ──────────────────
--   _ctx: service_role  (RLS 우회)
--   ⚠️ anon/publishable(RLS 적용) 키로 실행하면 clinic 격리 RLS 로 0-row(+error=null)
--      가 반환되어 "wipe 없음/empty" 로 오독됨. 반드시 service_role(SQL Editor 기본)로
--      실행하고, 0-row 결과는 RLS 아티팩트가 아니라 실제 무영향임을 컨텍스트로 확정할 것.
--
-- ── 화장품(retail) 라인 판별 SSOT ──────────────────────────────────────────────
--   services.category = '풋화장품'  또는  services.category_label = '풋화장품'
--   (isCosmeticService() FE SSOT 와 동일: PaymentMiniWindow.tsx L253-256)
-- ── alive 결제 판별 ────────────────────────────────────────────────────────────
--   payment_type='payment' 인 행의 순액(payment − refund) > 0 인 check_in.
-- ══════════════════════════════════════════════════════════════════════════════

-- 파라미터: 조사 구간을 좁히려면 각 쿼리의 created_at 하한을 조정(예: >= '2026-07-01').

-- ── §1. 재저장 지문 집계 ──────────────────────────────────────────────────────
--   한 check_in 의 cis 가 전원 동일 created_at(재저장 단일 트랜잭션 지문)을 갖고,
--   그 재저장 시각이 부모 결제 created_at 보다 나중 = delete-all→reinsert 발생 지문.
--   (F-4741 fdd5c165: 11 cis 전원 2026-08-03 01:25:16 동일 → 이 패턴에 해당)
WITH cis_fp AS (
  SELECT
    cis.check_in_id,
    count(*)                    AS cis_lines,
    count(DISTINCT cis.created_at) AS distinct_cts,
    max(cis.created_at)         AS cis_reinsert_ct
  FROM check_in_services cis
  GROUP BY cis.check_in_id
),
pay_alive AS (
  SELECT
    p.check_in_id,
    min(p.created_at) AS first_pay_ct,
    sum(CASE WHEN p.payment_type = 'payment' THEN p.amount
             WHEN p.payment_type = 'refund'  THEN -p.amount ELSE 0 END) AS net_paid
  FROM payments p
  WHERE p.check_in_id IS NOT NULL
  GROUP BY p.check_in_id
)
SELECT
  count(*) FILTER (WHERE f.distinct_cts = 1
                     AND f.cis_reinsert_ct > a.first_pay_ct)          AS resave_after_payment_checkins,
  count(*) FILTER (WHERE f.distinct_cts = 1)                          AS homogeneous_ct_checkins,
  count(*)                                                            AS total_paid_checkins_with_cis
FROM cis_fp f
JOIN pay_alive a ON a.check_in_id = f.check_in_id
WHERE a.net_paid > 0;

-- ── §2. 결제-라인 unlink census ──────────────────────────────────────────────
--   alive 결제(net_paid>0)인데 부모 check_in 에 화장품 cis 라인이 0건인 결제행.
--   payment_items(화장품 스냅샷·ON DELETE SET NULL 로 잔존)을 독립 증인으로 대조:
--   화장품 payment_items 는 있는데 대응 화장품 cis 는 없는 check_in = 소멸 강한 증거.
WITH cosmetic_cis AS (
  SELECT DISTINCT cis.check_in_id
  FROM check_in_services cis
  JOIN services s ON s.id = cis.service_id
  WHERE s.category = '풋화장품' OR s.category_label = '풋화장품'
),
cosmetic_pi AS (   -- payment_items 화장품 스냅샷(service_id 매칭 or 이름 폴백)
  SELECT
    pi.check_in_id,
    count(*)          AS cosmetic_pi_lines,
    sum(pi.line_amount) AS cosmetic_pi_amount
  FROM payment_items pi
  LEFT JOIN services s ON s.id = pi.service_id
  WHERE (s.category = '풋화장품' OR s.category_label = '풋화장품'
         OR pi.service_name LIKE '%화장품%')
    AND pi.check_in_id IS NOT NULL
  GROUP BY pi.check_in_id
),
pay_alive AS (
  SELECT
    p.check_in_id,
    p.customer_id,
    sum(CASE WHEN p.payment_type='payment' THEN p.amount
             WHEN p.payment_type='refund'  THEN -p.amount ELSE 0 END) AS net_paid
  FROM payments p
  WHERE p.check_in_id IS NOT NULL
  GROUP BY p.check_in_id, p.customer_id
)
SELECT
  -- payment_items 화장품 스냅샷은 있으나 화장품 cis 가 사라진 unlink 결제(강한 증거)
  count(*)                          FILTER (WHERE pi.check_in_id IS NOT NULL
                                              AND cc.check_in_id IS NULL) AS unlink_checkins,
  count(DISTINCT a.customer_id)     FILTER (WHERE pi.check_in_id IS NOT NULL
                                              AND cc.check_in_id IS NULL) AS unlink_customers,
  coalesce(sum(pi.cosmetic_pi_amount) FILTER (WHERE cc.check_in_id IS NULL), 0)
                                                                          AS unlink_cosmetic_amount,
  -- 참고: payment_items 미도입(legacy lump-sum)이라 witness 부재인 alive 결제 총수
  count(*)                          FILTER (WHERE pi.check_in_id IS NULL) AS no_pi_witness_checkins
FROM pay_alive a
LEFT JOIN cosmetic_cis cc ON cc.check_in_id = a.check_in_id
LEFT JOIN cosmetic_pi  pi ON pi.check_in_id = a.check_in_id
WHERE a.net_paid > 0;
-- 주: 위 §2 는 payment_items 도입분에 한해 강한 unlink 증거를 집계한다. payment_items 0행
--   (레거시 lump-sum) 구간은 witness 부재로 별도 추정 불가 → §3 매출정합으로 보완.

-- ── §3. 화장품 매출 line-item 정합 (cis 합 vs payment_items 스냅샷 합) ──────────
--   월별로 화장품 cis 라인 합계와 화장품 payment_items 스냅샷 합계를 비교.
--   payment_items 는 cis 삭제에도 잔존(ON DELETE SET NULL)하므로, pi 합 > cis 합 인
--   구간의 delta = 재저장으로 소멸한 화장품 라인 규모(매출 line-item 분해 divergence).
WITH cis_cosmetic AS (
  SELECT date_trunc('month', cis.created_at) AS mon,
         count(*) AS cis_lines, sum(cis.price) AS cis_amount
  FROM check_in_services cis
  JOIN services s ON s.id = cis.service_id
  WHERE s.category = '풋화장품' OR s.category_label = '풋화장품'
  GROUP BY 1
),
pi_cosmetic AS (
  SELECT date_trunc('month', pi.created_at) AS mon,
         count(*) AS pi_lines, sum(pi.line_amount) AS pi_amount
  FROM payment_items pi
  LEFT JOIN services s ON s.id = pi.service_id
  WHERE s.category = '풋화장품' OR s.category_label = '풋화장품'
     OR pi.service_name LIKE '%화장품%'
  GROUP BY 1
)
SELECT
  coalesce(c.mon, p.mon)                    AS month,
  coalesce(c.cis_lines, 0)                  AS cis_cosmetic_lines,
  coalesce(p.pi_lines, 0)                   AS pi_cosmetic_lines,
  coalesce(p.pi_lines, 0) - coalesce(c.cis_lines, 0)   AS lines_delta,   -- >0 = 소멸 의심
  coalesce(p.pi_amount, 0) - coalesce(c.cis_amount, 0) AS amount_delta
FROM cis_cosmetic c
FULL OUTER JOIN pi_cosmetic p ON p.mon = c.mon
ORDER BY 1;

-- ── §4. forward-risk: 비활성/부재 service 를 가리키는 현행 cis 라인 ─────────────
--   지금 살아있으나 service_id 가 비활성(active=false) 또는 부재 서비스를 가리켜,
--   다음 재저장 시 selectedItems 재구성에서 drop 될 예정인 잠재 소멸 대상.
--   (벡터 A=비활성 service / 벡터 B=NULL service_id)
SELECT
  count(*) FILTER (WHERE cis.service_id IS NULL)              AS null_service_id_lines,      -- 벡터 B
  count(*) FILTER (WHERE s.id IS NULL AND cis.service_id IS NOT NULL) AS missing_service_lines, -- 하드삭제 service
  count(*) FILTER (WHERE s.active = false)                    AS inactive_service_lines,     -- 벡터 A
  count(*) FILTER (WHERE (s.category = '풋화장품' OR s.category_label = '풋화장품')
                     AND (s.active = false))                  AS inactive_cosmetic_lines     -- 화장품 한정 forward-risk
FROM check_in_services cis
LEFT JOIN services s ON s.id = cis.service_id;

-- ══════════════════════════════════════════════════════════════════════════════
-- 해석 가이드
--  · §1 resave_after_payment_checkins > 0  → delete-all→reinsert 가 결제 후 실행된 규모.
--  · §2 unlink_checkins/customers/amount    → payment_items witness 기준 확정 unlink 규모.
--  · §3 lines_delta / amount_delta > 0      → 화장품 매출 line-item 분해 과소계상 규모(월별).
--  · §4 inactive_cosmetic_lines             → 아직 안 지워졌으나 재저장 시 소멸 예정 대상(예방 규모).
--  실 수치를 planner FOLLOWUP 에 첨부해 재발방지 fix / 소급 backfill 격상 판단에 사용.
-- ══════════════════════════════════════════════════════════════════════════════
