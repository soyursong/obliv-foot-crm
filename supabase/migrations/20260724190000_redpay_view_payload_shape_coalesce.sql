-- ══════════════════════════════════════════════════════════════════
-- T-20260724-foot-REDPAY-VIEW-PAYLOAD-SHAPE-FIX — 뷰/함수 payload-shape 이중대응(COALESCE fallback)
-- ══════════════════════════════════════════════════════════════════
-- 배경(parent T-20260724-foot-REDPAY-457-COUNT-RECONCILE, Branch B cause(a)):
--   7/23 실거래가 두 가지 shape 로 적재됨.
--     · 정규화(폴러 원본) shape : merchant = raw_payload->'merchant'->>'id',  tid = 컬럼 r.tid
--     · 중첩 envelope(웹훅) shape : merchant = raw_payload->'data'->>'merchant_id', tid = raw_payload->'data'->>'tid'
--       (최상위 merchant->id 와 컬럼 r.tid 는 둘 다 NULL)
--   구 뷰/함수는 정규화 shape 만 읽어 → 웹훅 shape 행의 merchant/tid 가 NULL →
--   IN(...) 3치논리(NULL)로 전건 탈락(레드페이 탭 소멸). read-side 결함(적재는 정상).
--
-- 봉합: shape 읽는 모든 소비처에 COALESCE fallback 를 fold —
--   merchant = COALESCE(raw_payload->'merchant'->>'id', raw_payload->'data'->>'merchant_id')
--   tid      = COALESCE(r.tid,                          raw_payload->'data'->>'tid')
--   → 중첩 envelope·평면 정규화 두 shape 모두 표면화.
--
-- ── ADDITIVE 계약 (DA CONSULT-REPLY, SSOT=da_decision_foot_redpay_view_payload_shape_coalesce_20260724.md, verdict 3/3 GO) ──
--   · CREATE OR REPLACE VIEW/FUNCTION — 컬럼 시그니처(이름/타입/순서/개수) byte-동일. 신규 컬럼/테이블/enum 0.
--   · base 테이블(redpay_raw_transactions/payments/registry) 무접촉. WHERE 술어만 COALESCE broaden = read-broadening ADDITIVE.
--   · `r.tid AS tid` → `COALESCE(r.tid, raw_payload->'data'->>'tid') AS tid` : 컬럼명/타입(text) 불변.
--   · 행-집합 확대(웹훅 shape 표면화)는 의도된 교정적 read-broadening. FE 소비계약(컬럼 by name/type) 무변경.
--   · 선례: 동일 뷰 SSOT마이그 20260711140000 이 CREATE OR REPLACE 재배선을 ADDITIVE(GO_WARN)로 처리.
--
-- ── observe-guard = REJECT (DA CONSULT-REPLY (b), 넣지 않음) ──
--   · UNIQUE(external_trxid,external_status,amount) + 웹훅·폴러 동일 onConflict 키 upsert →
--     같은 거래는 물리적으로 1행(status 수렴). 뷰 Part A = 단일테이블 스캔 + 행단위 COALESCE → 행 증식 0.
--     AC-3(중복표면화 없음)은 UNIQUE제약+단일스캔으로 정의상 충족. guard 불요.
--   · observe행(_mode='observe') = 서명검증 통과·실승인 카드거래(진짜 돈). matched_payment_id NULL →
--     recon_status='missing_in_crm' 로 뜨는 게 정확한 대사(현장 수동매칭 신호). guard 는 이 행을 재은닉 → 버그 재발.
--   · read-surfacing 축은 payments-WRITE 축(폴러 승격금지)과 분리. 폴러 isObserveRow 제외는 그대로 유지(무접촉).
--   · census 실측(scripts/..._census.mjs): 7/23 shape-blind 탈락 5행 전건 _mode='observe' → guard 유해 확증.
--
-- ── cause(a) ≠ cause(b) 직교 (DA CONSULT-REPLY (c) CONFIRMED) ──
--   · COALESCE 후에도 merchant/tid 는 여전히 registry(redpay_terminal_registry) IN 통과 필요.
--   · 본 티켓은 registry-내 건만 표면화. 신규TID(cause b)는 WATCHDOG/WHITELIST-EXPAND 의존.
--   · 7/23 5행은 merchant 는 registry-내이나 tid 가 신규(1047535xxx, registry=1047479xxx) → belt-and-suspenders
--     tid 필터에 여전히 탈락 = 정상. 완전 표면화는 T-20260724-foot-REDPAY-WHITELIST-EXPAND-0723GAP 의존(직교).
--
-- risk: GO(DA, ADDITIVE read-broadening). 회귀 방어 = 컬럼 시그니처 byte-동일 대조 + dryrun 무영속 + 정규화 shape 회귀 0.
-- Rollback: 20260724190000_redpay_view_payload_shape_coalesce.rollback.sql (COALESCE 제거 = 20260711140000 정의로 복원).
-- ══════════════════════════════════════════════════════════════════

-- ============================================================
-- 1. VIEW v_redpay_reconciliation_daily — Part A/B 에 shape COALESCE fold
-- ============================================================
CREATE OR REPLACE VIEW public.v_redpay_reconciliation_daily
WITH (security_invoker = true) AS
-- Part A: 레드페이 raw(풋) 앵커 — matched / amount_mismatch / missing_in_crm / refund_not_in_crm
SELECT
  r.id                                                        AS row_id,
  'redpay'::text                                              AS anchor,
  r.clinic_id                                                 AS clinic_id,
  (r.approved_at AT TIME ZONE 'Asia/Seoul')::date             AS close_date,
  r.approved_at                                               AS approved_at,
  r.external_trxid                                            AS external_trxid,
  r.external_status                                           AS external_status,
  COALESCE(r.tid, r.raw_payload->'data'->>'tid')              AS tid,          -- shape 이중대응(컬럼명/타입 text 불변)
  r.amount::numeric                                           AS van_amount,
  r.approval_no                                               AS approval_no,
  r.matched_payment_id                                        AS matched_payment_id,
  p.amount::numeric                                           AS crm_amount,
  p.method                                                    AS crm_method,
  p.created_at                                                AS crm_created_at,
  CASE
    WHEN r.external_status IN ('N','X','M')                 THEN 'refund_not_in_crm'
    WHEN r.matched_payment_id IS NULL                       THEN 'missing_in_crm'
    WHEN p.amount IS DISTINCT FROM r.amount                 THEN 'amount_mismatch'
    ELSE 'matched'
  END                                                         AS recon_status
FROM public.redpay_raw_transactions r
LEFT JOIN public.payments p ON p.id = r.matched_payment_id
WHERE COALESCE(r.raw_payload->'merchant'->>'id', r.raw_payload->'data'->>'merchant_id') IN (   -- 1차 권위: 풋 merchant_id (shape 이중대응, registry SSOT 파생)
  SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
)
AND COALESCE(r.tid, r.raw_payload->'data'->>'tid') IN (                                        -- belt-and-suspenders: 풋 TID (shape 이중대응, registry SSOT 파생)
  SELECT tid FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active AND tid IS NOT NULL
)

UNION ALL

-- Part B: CRM 카드결제 앵커 — missing_at_van (단말기 raw 없음). 당일 raw EXISTS 가드(AC-7 오탐 방지).
SELECT
  p.id                                                        AS row_id,
  'crm'::text                                                 AS anchor,
  p.clinic_id                                                 AS clinic_id,
  (p.created_at AT TIME ZONE 'Asia/Seoul')::date              AS close_date,
  NULL::timestamptz                                           AS approved_at,
  NULL::text                                                  AS external_trxid,
  NULL::text                                                  AS external_status,
  NULL::text                                                  AS tid,
  NULL::numeric                                               AS van_amount,
  NULL::text                                                  AS approval_no,
  NULL::uuid                                                  AS matched_payment_id,
  p.amount::numeric                                           AS crm_amount,
  p.method                                                    AS crm_method,
  p.created_at                                                AS crm_created_at,
  'missing_at_van'::text                                      AS recon_status
FROM public.payments p
WHERE p.method = 'card'
  AND p.payment_type = 'payment'
  AND COALESCE(p.status, '') <> 'deleted'
  AND p.reconciled_at IS NULL
  AND p.external_trxid IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.redpay_raw_transactions r2
    WHERE r2.clinic_id = p.clinic_id
      AND COALESCE(r2.raw_payload->'merchant'->>'id', r2.raw_payload->'data'->>'merchant_id') IN (   -- 1차 권위: 풋 merchant_id (shape 이중대응, registry SSOT 파생)
        SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
      )
      AND COALESCE(r2.tid, r2.raw_payload->'data'->>'tid') IN (                                       -- belt-and-suspenders: 풋 TID (shape 이중대응, registry SSOT 파생)
        SELECT tid FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active AND tid IS NOT NULL
      )
      AND (r2.approved_at AT TIME ZONE 'Asia/Seoul')::date
          = (p.created_at AT TIME ZONE 'Asia/Seoul')::date
  );

COMMENT ON VIEW public.v_redpay_reconciliation_daily IS
  'T-20260708-foot-REDPAY-CLOSING-TAB (T-20260711 registry 파생 / T-20260724 shape COALESCE 이중대응): 일마감 레드페이 하위탭 read-only 대조 뷰. '
  'redpay 승인 1건=1행(풋 merchant_id 1차 권위 + TID 보조, shape=merchant/data.merchant_id·r.tid/data.tid COALESCE, redpay_terminal_registry SSOT 파생) + missing_at_van(당일 raw EXISTS 가드). '
  'recon_status ∈ matched/missing_in_crm/missing_at_van/amount_mismatch/refund_not_in_crm. '
  'FE 는 이 뷰만 소비 — FE 조인/매칭 재계산 금지. security_invoker=true → 호출자 clinic RLS 적용.';

GRANT SELECT ON public.v_redpay_reconciliation_daily TO authenticated;

-- ============================================================
-- 2. FUNC get_redpay_feed_freshness() — 풋 필터 tid 를 shape COALESCE 로 전환
--    (foot_merchants/foot_tids CTE 는 registry 파생 유지. raw 대조 술어만 shape broaden.)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_redpay_feed_freshness()
RETURNS TABLE (
  last_approved_at    timestamptz,
  last_raw_updated_at timestamptz,
  last_incremental_to timestamptz,
  raw_count_today     bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()
  ),
  foot_merchants AS (   -- 1차 권위: 풋 merchant_id (registry SSOT 파생)
    SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
  ),
  foot_tids AS (        -- belt-and-suspenders: 풋 TID (registry SSOT 파생)
    SELECT tid FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active AND tid IS NOT NULL
  )
  SELECT
    (SELECT max(r.approved_at)
       FROM public.redpay_raw_transactions r
      WHERE r.clinic_id = (SELECT clinic_id FROM me)
        AND COALESCE(r.raw_payload->'merchant'->>'id', r.raw_payload->'data'->>'merchant_id') IN (SELECT merchant_id FROM foot_merchants)
        AND COALESCE(r.tid, r.raw_payload->'data'->>'tid') IN (SELECT tid FROM foot_tids)),
    (SELECT max(r.updated_at)
       FROM public.redpay_raw_transactions r
      WHERE r.clinic_id = (SELECT clinic_id FROM me)),
    (SELECT s.last_incremental_to
       FROM public.redpay_poller_state s WHERE s.id = 1),
    (SELECT count(*)
       FROM public.redpay_raw_transactions r
      WHERE r.clinic_id = (SELECT clinic_id FROM me)
        AND COALESCE(r.raw_payload->'merchant'->>'id', r.raw_payload->'data'->>'merchant_id') IN (SELECT merchant_id FROM foot_merchants)
        AND COALESCE(r.tid, r.raw_payload->'data'->>'tid') IN (SELECT tid FROM foot_tids)
        AND (r.approved_at AT TIME ZONE 'Asia/Seoul')::date
            = (now() AT TIME ZONE 'Asia/Seoul')::date);
$$;

COMMENT ON FUNCTION public.get_redpay_feed_freshness() IS
  'T-20260708-foot-REDPAY-CLOSING-TAB AC-7 (T-20260711 registry 파생 / T-20260724 shape COALESCE 이중대응): 레드페이 적재 freshness. '
  'last_approved_at=마지막 승인거래 시각, last_incremental_to=폴러 마지막 성공 to. '
  '풋 화이트리스트 = redpay_terminal_registry SSOT 파생, shape=merchant/data.merchant_id·r.tid/data.tid COALESCE. "거래 없음" vs "적재 死" 현장 구분용. '
  'SECURITY DEFINER(poller_state 안전 read), 호출자 clinic 스코프.';

GRANT EXECUTE ON FUNCTION public.get_redpay_feed_freshness() TO authenticated;

-- ============================================================
-- 3. VIEW v_receipt_settlement_daily — freshness LATERAL + rp 조인 필터 shape COALESCE (일관성, DA 후속flag ②)
--    (관측행은 matched_payment_id NULL 이라 rp 조인 미발화 = 당장 무해이나 surface 전반 shape 이중대응 일관.)
-- ============================================================
CREATE OR REPLACE VIEW public.v_receipt_settlement_daily
WITH (security_invoker = true) AS
SELECT
  p.id                                                        AS payment_id,
  p.clinic_id                                                 AS clinic_id,
  COALESCE(
    (p.ocr_receipt_datetime AT TIME ZONE 'Asia/Seoul')::date,
    (p.created_at           AT TIME ZONE 'Asia/Seoul')::date
  )                                                           AS close_date,
  p.ocr_receipt_datetime                                      AS receipt_datetime,
  p.created_at                                                AS uploaded_at,
  c.name                                                      AS customer_name,
  c.chart_number                                              AS chart_number,
  p.amount::numeric                                           AS amount,
  p.external_approval_no                                      AS approval_no,
  p.external_tid                                              AS tid,
  p.image_url                                                 AS image_url,
  p.reconciled_at                                             AS reconciled_at,
  rp.id                                                       AS redpay_row_id,
  rp.approved_at                                              AS redpay_approved_at,
  rp.amount::numeric                                          AS redpay_amount,
  COALESCE(rp.tid, rp.raw_payload->'data'->>'tid')            AS redpay_tid,    -- shape 이중대응(컬럼명/타입 text 불변)
  rp.match_rule                                               AS match_rule,
  rl.event_type                                               AS recon_event_type,
  rl.mismatch_reason                                          AS recon_mismatch_reason,
  CASE
    WHEN rp.id IS NOT NULL OR p.reconciled_at IS NOT NULL THEN 'matched'
    ELSE 'unmatched'
  END                                                         AS match_status,
  (SELECT max(r2.approved_at)
     FROM public.redpay_raw_transactions r2
     WHERE r2.clinic_id = p.clinic_id
       AND COALESCE(r2.raw_payload->'merchant'->>'id', r2.raw_payload->'data'->>'merchant_id') IN (   -- 1차 권위: 풋 merchant_id (shape 이중대응, registry SSOT 파생)
         SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
       )
       AND COALESCE(r2.tid, r2.raw_payload->'data'->>'tid') IN (                                       -- belt-and-suspenders: 풋 TID (shape 이중대응, registry SSOT 파생)
         SELECT tid FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active AND tid IS NOT NULL
       ))                                                     AS redpay_feed_last_approved_at
FROM public.payments p
JOIN public.customers c ON c.id = p.customer_id
LEFT JOIN public.redpay_raw_transactions rp
       ON rp.matched_payment_id = p.id
      AND COALESCE(rp.raw_payload->'merchant'->>'id', rp.raw_payload->'data'->>'merchant_id') IN (     -- 1차 권위: 풋 merchant_id (shape 이중대응, registry SSOT 파생)
        SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
      )
      AND COALESCE(rp.tid, rp.raw_payload->'data'->>'tid') IN (                                        -- belt-and-suspenders: 풋 TID (shape 이중대응, registry SSOT 파생)
        SELECT tid FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active AND tid IS NOT NULL
      )
LEFT JOIN LATERAL (
  SELECT rl2.event_type, rl2.mismatch_reason
  FROM public.payment_reconciliation_log rl2
  WHERE rl2.payment_id = p.id
  ORDER BY rl2.created_at DESC
  LIMIT 1
) rl ON true
WHERE p.image_url IS NOT NULL
  AND p.payment_type = 'payment'
  AND COALESCE(p.status, '') <> 'deleted';

COMMENT ON VIEW public.v_receipt_settlement_daily IS
  'T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD (T-20260711 registry 파생 / T-20260724 shape COALESCE 이중대응): [영수증 수납] 탭 read-only 대조 뷰. '
  'grain=OCR 영수증 첨부 수납 1건=1행. ★매칭 재계산 없음 — 매처(EF)가 영속화한 결과 surface only. '
  '풋 merchant_id 1차 권위 + TID 보조 = redpay_terminal_registry SSOT 파생, shape=merchant/data.merchant_id·rp.tid/data.tid COALESCE. §789 freshness 노출. '
  'match_status ∈ matched/unmatched. FE 는 이 뷰만 소비. security_invoker=true.';

GRANT SELECT ON public.v_receipt_settlement_daily TO authenticated;

-- ============================================================
-- 4. VIEW v_redpay_unclassified_merchants — 알람도 shape-blind 봉합 (DA 후속flag ①, silent drop 방지)
--    구 정의는 merchant->id 만 읽어 웹훅shape 신규단말이 미분류 알람에도 안 뜸(cause(b) 탐지루프 붕괴).
--    merchant_id/merchant_name/tid 를 shape COALESCE → 웹훅shape 신규단말도 알람에 표면화.
-- ============================================================
CREATE OR REPLACE VIEW public.v_redpay_unclassified_merchants
WITH (security_invoker = true) AS
SELECT
  r.clinic_id                                                                   AS clinic_id,
  COALESCE(r.raw_payload->'merchant'->>'id',   r.raw_payload->'data'->>'merchant_id')   AS merchant_id,     -- shape 이중대응
  COALESCE(r.raw_payload->'merchant'->>'name', r.raw_payload->'data'->>'merchant_name') AS merchant_name,   -- shape 이중대응
  COALESCE(r.tid, r.raw_payload->'data'->>'tid')                                 AS tid,                     -- shape 이중대응
  count(*)                                                                       AS trx_count,
  min(r.approved_at)                                                             AS first_seen_at,
  max(r.approved_at)                                                             AS last_seen_at
FROM public.redpay_raw_transactions r
WHERE COALESCE(r.raw_payload->'merchant'->>'id', r.raw_payload->'data'->>'merchant_id') IS NOT NULL
  AND COALESCE(r.raw_payload->'merchant'->>'id', r.raw_payload->'data'->>'merchant_id') NOT IN (
    SELECT merchant_id FROM public.redpay_terminal_registry WHERE active
  )
GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW public.v_redpay_unclassified_merchants IS
  'T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE 알람 (T-20260724 shape COALESCE 이중대응): business_no 511-60-00988/457-23-00938 피드 중 '
  'redpay_terminal_registry(active) 에 없는 merchant = 미분류/신규 단말 후보(silent include/drop 금지). '
  'merchant_id/merchant_name/tid shape=merchant/data.* COALESCE → 웹훅shape 신규단말도 표면화(cause(b) 탐지루프 유지). '
  '행 존재 = registry 갱신 필요 신호. 도메인 확장 seed 시 자동 이탈. security_invoker=true.';

GRANT SELECT ON public.v_redpay_unclassified_merchants TO authenticated;

-- 원장 기록 (schema_migrations ledger — 재실행 시 충돌 무시)
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260724190000', 'redpay_view_payload_shape_coalesce')
ON CONFLICT (version) DO NOTHING;
