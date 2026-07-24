-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260724-foot-REDPAY-WHITELIST-EXPAND-0723GAP (Opt-B′)
-- ══════════════════════════════════════════════════════════════════
-- 데이터손실 0. 마이그 전 상태(20260711140000 registry-파생, UNION 이전)로 복원.
--   1. 소비뷰/함수 → UNION 이전 registry-파생 정의로 CREATE OR REPLACE (superseded_tids 미참조).
--   2. 5 merchant remap 역전: tid=구 TID 복원, superseded_tids=NULL.
--   3. merchant 285002 DELETE(신규 편입분 회수).
--   4. DROP COLUMN superseded_tids.
-- ⚠ 순서: 뷰가 superseded_tids 를 참조하므로 뷰 복원(1) → DROP COLUMN(4) 순 필수.
-- ⚠ 재pull 로 적재된 신 TID(1047535xxx)·285002 raw 행은 append-only SSOT 라 잔존하나,
--   뷰 tid-membership 이 구 TID 로 복귀 → 뷰에서 자동 제외(마이그 전 표면화 동작 복원). 원장 무접점.
-- ══════════════════════════════════════════════════════════════════

-- 1a. VIEW v_redpay_reconciliation_daily — UNION 이전 정의 복원
CREATE OR REPLACE VIEW public.v_redpay_reconciliation_daily
WITH (security_invoker = true) AS
SELECT r.id AS row_id,
    'redpay'::text AS anchor,
    r.clinic_id,
    (r.approved_at AT TIME ZONE 'Asia/Seoul'::text)::date AS close_date,
    r.approved_at,
    r.external_trxid,
    r.external_status,
    COALESCE(r.tid, (r.raw_payload -> 'data'::text) ->> 'tid'::text) AS tid,
    r.amount::numeric AS van_amount,
    r.approval_no,
    r.matched_payment_id,
    p.amount::numeric AS crm_amount,
    p.method AS crm_method,
    p.created_at AS crm_created_at,
        CASE
            WHEN r.external_status = ANY (ARRAY['N'::text, 'X'::text, 'M'::text]) THEN 'refund_not_in_crm'::text
            WHEN r.matched_payment_id IS NULL THEN 'missing_in_crm'::text
            WHEN p.amount IS DISTINCT FROM r.amount THEN 'amount_mismatch'::text
            ELSE 'matched'::text
        END AS recon_status
   FROM redpay_raw_transactions r
     LEFT JOIN payments p ON p.id = r.matched_payment_id
  WHERE (COALESCE((r.raw_payload -> 'merchant'::text) ->> 'id'::text, (r.raw_payload -> 'data'::text) ->> 'merchant_id'::text) IN ( SELECT redpay_terminal_registry.merchant_id
           FROM redpay_terminal_registry
          WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active)) AND (COALESCE(r.tid, (r.raw_payload -> 'data'::text) ->> 'tid'::text) IN ( SELECT redpay_terminal_registry.tid
           FROM redpay_terminal_registry
          WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.tid IS NOT NULL))
UNION ALL
 SELECT p.id AS row_id,
    'crm'::text AS anchor,
    p.clinic_id,
    (p.created_at AT TIME ZONE 'Asia/Seoul'::text)::date AS close_date,
    NULL::timestamp with time zone AS approved_at,
    NULL::text AS external_trxid,
    NULL::text AS external_status,
    NULL::text AS tid,
    NULL::numeric AS van_amount,
    NULL::text AS approval_no,
    NULL::uuid AS matched_payment_id,
    p.amount::numeric AS crm_amount,
    p.method AS crm_method,
    p.created_at AS crm_created_at,
    'missing_at_van'::text AS recon_status
   FROM payments p
  WHERE p.method = 'card'::text AND p.payment_type = 'payment'::text AND COALESCE(p.status, ''::text) <> 'deleted'::text AND p.reconciled_at IS NULL AND p.external_trxid IS NULL AND (EXISTS ( SELECT 1
           FROM redpay_raw_transactions r2
          WHERE r2.clinic_id = p.clinic_id AND (COALESCE((r2.raw_payload -> 'merchant'::text) ->> 'id'::text, (r2.raw_payload -> 'data'::text) ->> 'merchant_id'::text) IN ( SELECT redpay_terminal_registry.merchant_id
                   FROM redpay_terminal_registry
                  WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active)) AND (COALESCE(r2.tid, (r2.raw_payload -> 'data'::text) ->> 'tid'::text) IN ( SELECT redpay_terminal_registry.tid
                   FROM redpay_terminal_registry
                  WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.tid IS NOT NULL)) AND (r2.approved_at AT TIME ZONE 'Asia/Seoul'::text)::date = (p.created_at AT TIME ZONE 'Asia/Seoul'::text)::date));

GRANT SELECT ON public.v_redpay_reconciliation_daily TO authenticated;

-- 1b. VIEW v_receipt_settlement_daily — UNION 이전 정의 복원
CREATE OR REPLACE VIEW public.v_receipt_settlement_daily
WITH (security_invoker = true) AS
 SELECT p.id AS payment_id,
    p.clinic_id,
    COALESCE((p.ocr_receipt_datetime AT TIME ZONE 'Asia/Seoul'::text)::date, (p.created_at AT TIME ZONE 'Asia/Seoul'::text)::date) AS close_date,
    p.ocr_receipt_datetime AS receipt_datetime,
    p.created_at AS uploaded_at,
    c.name AS customer_name,
    c.chart_number,
    p.amount::numeric AS amount,
    p.external_approval_no AS approval_no,
    p.external_tid AS tid,
    p.image_url,
    p.reconciled_at,
    rp.id AS redpay_row_id,
    rp.approved_at AS redpay_approved_at,
    rp.amount::numeric AS redpay_amount,
    COALESCE(rp.tid, (rp.raw_payload -> 'data'::text) ->> 'tid'::text) AS redpay_tid,
    rp.match_rule,
    rl.event_type AS recon_event_type,
    rl.mismatch_reason AS recon_mismatch_reason,
        CASE
            WHEN rp.id IS NOT NULL OR p.reconciled_at IS NOT NULL THEN 'matched'::text
            ELSE 'unmatched'::text
        END AS match_status,
    ( SELECT max(r2.approved_at) AS max
           FROM redpay_raw_transactions r2
          WHERE r2.clinic_id = p.clinic_id AND (COALESCE((r2.raw_payload -> 'merchant'::text) ->> 'id'::text, (r2.raw_payload -> 'data'::text) ->> 'merchant_id'::text) IN ( SELECT redpay_terminal_registry.merchant_id
                   FROM redpay_terminal_registry
                  WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active)) AND (COALESCE(r2.tid, (r2.raw_payload -> 'data'::text) ->> 'tid'::text) IN ( SELECT redpay_terminal_registry.tid
                   FROM redpay_terminal_registry
                  WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.tid IS NOT NULL))) AS redpay_feed_last_approved_at
   FROM payments p
     JOIN customers c ON c.id = p.customer_id
     LEFT JOIN redpay_raw_transactions rp ON rp.matched_payment_id = p.id AND (COALESCE((rp.raw_payload -> 'merchant'::text) ->> 'id'::text, (rp.raw_payload -> 'data'::text) ->> 'merchant_id'::text) IN ( SELECT redpay_terminal_registry.merchant_id
           FROM redpay_terminal_registry
          WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active)) AND (COALESCE(rp.tid, (rp.raw_payload -> 'data'::text) ->> 'tid'::text) IN ( SELECT redpay_terminal_registry.tid
           FROM redpay_terminal_registry
          WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.tid IS NOT NULL))
     LEFT JOIN LATERAL ( SELECT rl2.event_type,
            rl2.mismatch_reason
           FROM payment_reconciliation_log rl2
          WHERE rl2.payment_id = p.id
          ORDER BY rl2.created_at DESC
         LIMIT 1) rl ON true
  WHERE p.image_url IS NOT NULL AND p.payment_type = 'payment'::text AND COALESCE(p.status, ''::text) <> 'deleted'::text;

GRANT SELECT ON public.v_receipt_settlement_daily TO authenticated;

-- 1c. FUNC get_redpay_feed_freshness() — UNION 이전 정의 복원
CREATE OR REPLACE FUNCTION public.get_redpay_feed_freshness()
RETURNS TABLE(last_approved_at timestamp with time zone, last_raw_updated_at timestamp with time zone, last_incremental_to timestamp with time zone, raw_count_today bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION public.get_redpay_feed_freshness() TO authenticated;

-- 2. 5 merchant remap 역전 — tid=구 TID 복원, superseded_tids=NULL
WITH remap(merchant_id, old_tid) AS (
  VALUES
    ('1777285001', '1047479255'),
    ('1777285003', '1047479254'),
    ('1777285005', '1047479268'),
    ('1777285006', '1047479262'),
    ('1777285007', '1047479263')
)
UPDATE public.redpay_terminal_registry t
SET tid = m.old_tid,
    superseded_tids = NULL,
    updated_at = now()
FROM remap m
WHERE t.merchant_id = m.merchant_id
  AND t.domain = 'foot';

-- 3. merchant 285002 DELETE (신규 편입 회수)
DELETE FROM public.redpay_terminal_registry
WHERE domain = 'foot' AND merchant_id = '1777285002';

-- 4. DROP COLUMN superseded_tids (뷰 복원 후)
ALTER TABLE public.redpay_terminal_registry
  DROP COLUMN IF EXISTS superseded_tids;

-- ── 원장 되돌림 ──
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260724170000';
