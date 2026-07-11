-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE
-- ══════════════════════════════════════════════════════════════════
-- 역연산 = (a) 뷰/함수를 하드코딩 17-set 정의로 복원(테이블 파생 제거),
--          (b) 알람 뷰 DROP, (c) 레지스트리 테이블 DROP.
-- 데이터 손실 0: 뷰/함수는 파생 read-layer, 테이블은 본 티켓 신설분(원장 무접촉).
-- 폴러(scripts/redpay_macstudio_poller.mjs)는 DB 미가용 시 하드코딩 DEFAULT 로 폴백하므로
--   본 롤백 후에도 env/DEFAULT 로 정상 동작(테이블 조회 실패 → DEFAULT fail-safe).
-- ══════════════════════════════════════════════════════════════════

-- ── (a-1) v_redpay_reconciliation_daily 복원 — 하드코딩 merchant/tid IN(17) ──
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
  '1777285001','1777285004','1777288001','1777288004','1777289001',
  '1777289002','1777289003','1777289004','1777289005','1777289006',
  '1777289007','1777289008','1777289009','1777289010','1777289011',
  '1777289012','1777289013'
)
AND r.tid IN (
  '1047479255','1047479261','1047479469','1047479472','1047479483',
  '1047479476','1047479477','1047479478','1047479479','1047479480',
  '1047479481','1047479482','1047479153','1047479148','1047479155',
  '1047479158','1047479157'
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
        '1777285001','1777285004','1777288001','1777288004','1777289001',
        '1777289002','1777289003','1777289004','1777289005','1777289006',
        '1777289007','1777289008','1777289009','1777289010','1777289011',
        '1777289012','1777289013'
      )
      AND r2.tid IN (
        '1047479255','1047479261','1047479469','1047479472','1047479483',
        '1047479476','1047479477','1047479478','1047479479','1047479480',
        '1047479481','1047479482','1047479153','1047479148','1047479155',
        '1047479158','1047479157'
      )
      AND (r2.approved_at AT TIME ZONE 'Asia/Seoul')::date
          = (p.created_at AT TIME ZONE 'Asia/Seoul')::date
  );

GRANT SELECT ON public.v_redpay_reconciliation_daily TO authenticated;

-- ── (a-2) get_redpay_feed_freshness() 복원 — 하드코딩 merchant/tid CTE ──
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
    SELECT unnest(ARRAY[
      '1777285001','1777285004','1777288001','1777288004','1777289001',
      '1777289002','1777289003','1777289004','1777289005','1777289006',
      '1777289007','1777289008','1777289009','1777289010','1777289011',
      '1777289012','1777289013'
    ]) AS merchant_id
  ),
  foot_tids AS (
    SELECT unnest(ARRAY[
      '1047479255','1047479261','1047479469','1047479472','1047479483',
      '1047479476','1047479477','1047479478','1047479479','1047479480',
      '1047479481','1047479482','1047479153','1047479148','1047479155',
      '1047479158','1047479157'
    ]) AS tid
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

-- ── (a-3) v_receipt_settlement_daily 복원 — 하드코딩 merchant/tid IN(17) ──
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
         '1777285001','1777285004','1777288001','1777288004','1777289001',
         '1777289002','1777289003','1777289004','1777289005','1777289006',
         '1777289007','1777289008','1777289009','1777289010','1777289011',
         '1777289012','1777289013'
       )
       AND r2.tid IN (
         '1047479255','1047479261','1047479469','1047479472','1047479483',
         '1047479476','1047479477','1047479478','1047479479','1047479480',
         '1047479481','1047479482','1047479153','1047479148','1047479155',
         '1047479158','1047479157'
       ))                                                     AS redpay_feed_last_approved_at
FROM public.payments p
JOIN public.customers c ON c.id = p.customer_id
LEFT JOIN public.redpay_raw_transactions rp
       ON rp.matched_payment_id = p.id
      AND (rp.raw_payload->'merchant'->>'id') IN (
        '1777285001','1777285004','1777288001','1777288004','1777289001',
        '1777289002','1777289003','1777289004','1777289005','1777289006',
        '1777289007','1777289008','1777289009','1777289010','1777289011',
        '1777289012','1777289013'
      )
      AND rp.tid IN (
        '1047479255','1047479261','1047479469','1047479472','1047479483',
        '1047479476','1047479477','1047479478','1047479479','1047479480',
        '1047479481','1047479482','1047479153','1047479148','1047479155',
        '1047479158','1047479157'
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

-- ── (b) 알람 뷰 DROP ──
DROP VIEW IF EXISTS public.v_redpay_unclassified_merchants;

-- ── (c) 레지스트리 테이블 DROP (본 티켓 신설분) ──
DROP TABLE IF EXISTS public.redpay_terminal_registry;

-- 원장에서 제거
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260711140000';
