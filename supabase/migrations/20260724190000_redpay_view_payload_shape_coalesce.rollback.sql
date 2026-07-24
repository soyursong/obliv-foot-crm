-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260724-foot-REDPAY-VIEW-PAYLOAD-SHAPE-FIX
--   COALESCE shape 이중대응을 제거하고 20260711140000_redpay_terminal_registry_ssot 정의로 복원.
--   (컬럼 시그니처 동일 → CREATE OR REPLACE 로 무손실 복원. 데이터/base 테이블 무접촉.)
--   복원 후 웹훅 중첩 envelope shape 행은 다시 표면화되지 않음(구 read-side 결함 상태로 회귀).
-- ══════════════════════════════════════════════════════════════════

-- 1. VIEW v_redpay_reconciliation_daily — 정규화 shape 전용(COALESCE 제거)
CREATE OR REPLACE VIEW public.v_redpay_reconciliation_daily
WITH (security_invoker = true) AS
SELECT
  r.id                                                        AS row_id,
  'redpay'::text                                              AS anchor,
  r.clinic_id                                                 AS clinic_id,
  (r.approved_at AT TIME ZONE 'Asia/Seoul')::date             AS close_date,
  r.approved_at                                               AS approved_at,
  r.external_trxid                                            AS external_trxid,
  r.external_status                                           AS external_status,
  r.tid                                                       AS tid,
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
WHERE (r.raw_payload->'merchant'->>'id') IN (
  SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
)
AND r.tid IN (
  SELECT tid FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active AND tid IS NOT NULL
)

UNION ALL

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
      AND (r2.raw_payload->'merchant'->>'id') IN (
        SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
      )
      AND r2.tid IN (
        SELECT tid FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active AND tid IS NOT NULL
      )
      AND (r2.approved_at AT TIME ZONE 'Asia/Seoul')::date
          = (p.created_at AT TIME ZONE 'Asia/Seoul')::date
  );

GRANT SELECT ON public.v_redpay_reconciliation_daily TO authenticated;

-- 2. FUNC get_redpay_feed_freshness() — 정규화 shape 전용(COALESCE 제거)
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
  foot_merchants AS (
    SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
  ),
  foot_tids AS (
    SELECT tid FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active AND tid IS NOT NULL
  )
  SELECT
    (SELECT max(r.approved_at)
       FROM public.redpay_raw_transactions r
      WHERE r.clinic_id = (SELECT clinic_id FROM me)
        AND (r.raw_payload->'merchant'->>'id') IN (SELECT merchant_id FROM foot_merchants)
        AND r.tid IN (SELECT tid FROM foot_tids)),
    (SELECT max(r.updated_at)
       FROM public.redpay_raw_transactions r
      WHERE r.clinic_id = (SELECT clinic_id FROM me)),
    (SELECT s.last_incremental_to
       FROM public.redpay_poller_state s WHERE s.id = 1),
    (SELECT count(*)
       FROM public.redpay_raw_transactions r
      WHERE r.clinic_id = (SELECT clinic_id FROM me)
        AND (r.raw_payload->'merchant'->>'id') IN (SELECT merchant_id FROM foot_merchants)
        AND r.tid IN (SELECT tid FROM foot_tids)
        AND (r.approved_at AT TIME ZONE 'Asia/Seoul')::date
            = (now() AT TIME ZONE 'Asia/Seoul')::date);
$$;

GRANT EXECUTE ON FUNCTION public.get_redpay_feed_freshness() TO authenticated;

-- 3. VIEW v_receipt_settlement_daily — 정규화 shape 전용(COALESCE 제거)
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
  rp.tid                                                      AS redpay_tid,
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
       AND (r2.raw_payload->'merchant'->>'id') IN (
         SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
       )
       AND r2.tid IN (
         SELECT tid FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active AND tid IS NOT NULL
       ))                                                     AS redpay_feed_last_approved_at
FROM public.payments p
JOIN public.customers c ON c.id = p.customer_id
LEFT JOIN public.redpay_raw_transactions rp
       ON rp.matched_payment_id = p.id
      AND (rp.raw_payload->'merchant'->>'id') IN (
        SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
      )
      AND rp.tid IN (
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

GRANT SELECT ON public.v_receipt_settlement_daily TO authenticated;

-- 4. VIEW v_redpay_unclassified_merchants — merchant->id 전용(COALESCE 제거)
CREATE OR REPLACE VIEW public.v_redpay_unclassified_merchants
WITH (security_invoker = true) AS
SELECT
  r.clinic_id                              AS clinic_id,
  (r.raw_payload->'merchant'->>'id')       AS merchant_id,
  (r.raw_payload->'merchant'->>'name')     AS merchant_name,
  r.tid                                    AS tid,
  count(*)                                 AS trx_count,
  min(r.approved_at)                       AS first_seen_at,
  max(r.approved_at)                       AS last_seen_at
FROM public.redpay_raw_transactions r
WHERE (r.raw_payload->'merchant'->>'id') IS NOT NULL
  AND (r.raw_payload->'merchant'->>'id') NOT IN (
    SELECT merchant_id FROM public.redpay_terminal_registry WHERE active
  )
GROUP BY 1, 2, 3, 4;

GRANT SELECT ON public.v_redpay_unclassified_merchants TO authenticated;
