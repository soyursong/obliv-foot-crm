-- DRYRUN (no-persistence): T-20260803-foot-REDPAY-INSTALLVERIFY-NET0-AUTOCLASSIFY
--   목적: up.sql 전제(redpay_raw_transactions/redpay_terminal_registry/payments 실재 + 필요 컬럼)
--         + 뷰 2종(v_redpay_installverify_pairs, v_redpay_reconciliation_daily) 컴파일·실행·신규컬럼
--         을 prod 무영속 검증.
--   Migration Dry-Run No-Persistence Protocol 준수: 전 구간 단일 txn BEGIN..ROLLBACK, COMMIT 문 0
--     → sentinel-bypass hazard 없음(영속 0). 성공 경로도 마지막 ROLLBACK 으로 무영속 보장.
--   실행: psql -f 이 파일 (prod). 'DRYRUN OK' NOTICE 뜬 뒤 ROLLBACK → 영속 0.

BEGIN;

-- ── 1) 전제: 의존객체/컬럼 실재 ──
DO $$
DECLARE v_missing TEXT := '';
BEGIN
  IF to_regclass('public.redpay_raw_transactions') IS NULL THEN
    v_missing := v_missing || ' public.redpay_raw_transactions'; END IF;
  IF to_regclass('public.redpay_terminal_registry') IS NULL THEN
    v_missing := v_missing || ' public.redpay_terminal_registry'; END IF;
  IF to_regclass('public.payments') IS NULL THEN
    v_missing := v_missing || ' public.payments'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='redpay_raw_transactions' AND column_name='cancelled_at') THEN
    v_missing := v_missing || ' redpay_raw_transactions.cancelled_at'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='redpay_raw_transactions' AND column_name='approval_no') THEN
    v_missing := v_missing || ' redpay_raw_transactions.approval_no'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='redpay_terminal_registry' AND column_name='superseded_tids') THEN
    v_missing := v_missing || ' redpay_terminal_registry.superseded_tids'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    v_missing := v_missing || ' supabase_migrations.schema_migrations(ledger)'; END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'DRYRUN FAIL — 전제 미충족:%', v_missing;
  END IF;
  RAISE NOTICE 'DRYRUN OK — 전제 충족(의존객체/컬럼 실재)';
END $$;

-- ── 2) 분류엔진 뷰 생성 (up.sql §1 동일) ──
CREATE OR REPLACE VIEW public.v_redpay_installverify_pairs
WITH (security_invoker = true) AS
WITH foot_raw AS (
  SELECT
    r.id, r.clinic_id,
    COALESCE(r.tid, (r.raw_payload -> 'data'::text) ->> 'tid'::text) AS tid,
    r.approval_no, r.external_status, r.amount, r.approved_at, r.cancelled_at, r.external_trxid
  FROM public.redpay_raw_transactions r
  WHERE (COALESCE((r.raw_payload -> 'merchant'::text) ->> 'id'::text, (r.raw_payload -> 'data'::text) ->> 'merchant_id'::text) IN (
           SELECT redpay_terminal_registry.merchant_id FROM public.redpay_terminal_registry
            WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active))
    AND (COALESCE(r.tid, (r.raw_payload -> 'data'::text) ->> 'tid'::text) IN (
           SELECT redpay_terminal_registry.tid FROM public.redpay_terminal_registry
            WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.tid IS NOT NULL
           UNION
           SELECT unnest(redpay_terminal_registry.superseded_tids) FROM public.redpay_terminal_registry
            WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.superseded_tids IS NOT NULL))
),
tid_counts AS (
  SELECT clinic_id, tid, count(*) AS n FROM foot_raw WHERE tid IS NOT NULL GROUP BY clinic_id, tid
),
pairs AS (
  SELECT a.clinic_id, a.tid, a.approval_no, a.id AS approval_row_id, c.id AS cancel_row_id,
    a.external_trxid AS approval_trxid, c.external_trxid AS cancel_trxid,
    a.amount AS approval_amount, c.amount AS cancel_amount,
    a.approved_at AS approval_at, COALESCE(c.cancelled_at, c.approved_at) AS cancel_at,
    EXTRACT(EPOCH FROM (COALESCE(c.cancelled_at, c.approved_at) - a.approved_at)) AS gap_sec
  FROM foot_raw a
  JOIN foot_raw c ON c.clinic_id = a.clinic_id AND c.tid = a.tid AND c.approval_no = a.approval_no
  WHERE a.tid IS NOT NULL AND a.approval_no IS NOT NULL
    AND a.external_status = 'Y' AND a.amount > 0
    AND c.external_status = ANY (ARRAY['N'::text, 'X'::text, 'M'::text]) AND c.amount < 0
    AND (a.amount + c.amount) = 0
    AND a.approved_at IS NOT NULL AND COALESCE(c.cancelled_at, c.approved_at) IS NOT NULL
)
SELECT p.clinic_id, p.tid, p.approval_no, p.approval_row_id, p.cancel_row_id,
  p.approval_trxid, p.cancel_trxid, p.approval_amount, p.cancel_amount,
  p.approval_at, p.cancel_at, p.gap_sec, tc.n AS tid_txn_count,
  (p.approval_at AT TIME ZONE 'Asia/Seoul'::text)::date AS close_date,
  jsonb_build_object(
    'classified', '설치검증_추정', 'cond1_net0_same_tid_amount_approval', true,
    'cond2_cancel_gap_sec', round(p.gap_sec)::int, 'cond2_threshold_sec', 120,
    'cond3_tid_txn_count', tc.n, 'cond4_amount', p.approval_amount,
    'approval_trxid', p.approval_trxid, 'cancel_trxid', p.cancel_trxid,
    'approval_at', p.approval_at, 'cancel_at', p.cancel_at,
    'approval_no', p.approval_no, 'tid', p.tid
  ) AS install_verify_evidence
FROM pairs p JOIN tid_counts tc ON tc.clinic_id = p.clinic_id AND tc.tid = p.tid
WHERE tc.n = 2 AND p.gap_sec >= 0 AND p.gap_sec <= 120
  AND p.approval_amount IN (100, 500, 1000, 1004);

-- ── 3) 대사뷰 REPLACE (up.sql §2 — install_verify 2컬럼 + LEFT JOIN pairs) ──
DROP VIEW IF EXISTS public.v_redpay_reconciliation_daily;
CREATE OR REPLACE VIEW public.v_redpay_reconciliation_daily
WITH (security_invoker = true) AS
SELECT r.id AS row_id, 'redpay'::text AS anchor, r.clinic_id,
    (r.approved_at AT TIME ZONE 'Asia/Seoul'::text)::date AS close_date,
    r.approved_at, r.external_trxid, r.external_status,
    COALESCE(r.tid, (r.raw_payload -> 'data'::text) ->> 'tid'::text) AS tid,
    r.amount::numeric AS van_amount, r.approval_no, r.matched_payment_id,
    p.amount::numeric AS crm_amount, p.method AS crm_method, p.created_at AS crm_created_at,
        CASE
            WHEN r.external_status = ANY (ARRAY['N'::text, 'X'::text, 'M'::text]) THEN 'refund_not_in_crm'::text
            WHEN r.matched_payment_id IS NULL THEN 'missing_in_crm'::text
            WHEN p.amount IS DISTINCT FROM r.amount THEN 'amount_mismatch'::text
            ELSE 'matched'::text
        END AS recon_status,
    (iv.approval_row_id IS NOT NULL) AS install_verify_presumed,
    iv.install_verify_evidence AS install_verify_evidence
   FROM redpay_raw_transactions r
     LEFT JOIN payments p ON p.id = r.matched_payment_id
     LEFT JOIN public.v_redpay_installverify_pairs iv
            ON iv.clinic_id = r.clinic_id AND (r.id = iv.approval_row_id OR r.id = iv.cancel_row_id)
  WHERE (COALESCE((r.raw_payload -> 'merchant'::text) ->> 'id'::text, (r.raw_payload -> 'data'::text) ->> 'merchant_id'::text) IN ( SELECT redpay_terminal_registry.merchant_id
           FROM redpay_terminal_registry WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active))
    AND (COALESCE(r.tid, (r.raw_payload -> 'data'::text) ->> 'tid'::text) IN (
           SELECT redpay_terminal_registry.tid FROM redpay_terminal_registry
            WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.tid IS NOT NULL
           UNION
           SELECT unnest(redpay_terminal_registry.superseded_tids) FROM redpay_terminal_registry
            WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.superseded_tids IS NOT NULL))
UNION ALL
 SELECT p.id AS row_id, 'crm'::text AS anchor, p.clinic_id,
    (p.created_at AT TIME ZONE 'Asia/Seoul'::text)::date AS close_date,
    NULL::timestamp with time zone AS approved_at, NULL::text AS external_trxid, NULL::text AS external_status,
    NULL::text AS tid, NULL::numeric AS van_amount, NULL::text AS approval_no, NULL::uuid AS matched_payment_id,
    p.amount::numeric AS crm_amount, p.method AS crm_method, p.created_at AS crm_created_at,
    'missing_at_van'::text AS recon_status,
    false AS install_verify_presumed, NULL::jsonb AS install_verify_evidence
   FROM payments p
  WHERE p.method = 'card'::text AND p.payment_type = 'payment'::text AND COALESCE(p.status, ''::text) <> 'deleted'::text AND p.reconciled_at IS NULL AND p.external_trxid IS NULL AND (EXISTS ( SELECT 1
           FROM redpay_raw_transactions r2
          WHERE r2.clinic_id = p.clinic_id AND (COALESCE((r2.raw_payload -> 'merchant'::text) ->> 'id'::text, (r2.raw_payload -> 'data'::text) ->> 'merchant_id'::text) IN ( SELECT redpay_terminal_registry.merchant_id
                   FROM redpay_terminal_registry WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active))
            AND (COALESCE(r2.tid, (r2.raw_payload -> 'data'::text) ->> 'tid'::text) IN (
                   SELECT redpay_terminal_registry.tid FROM redpay_terminal_registry
                    WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.tid IS NOT NULL
                   UNION
                   SELECT unnest(redpay_terminal_registry.superseded_tids) FROM redpay_terminal_registry
                    WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.superseded_tids IS NOT NULL))
            AND (r2.approved_at AT TIME ZONE 'Asia/Seoul'::text)::date = (p.created_at AT TIME ZONE 'Asia/Seoul'::text)::date));

-- ── 4) 스모크: 뷰 실행 + 신규컬럼 존재 검증 ──
DO $$
BEGIN
  PERFORM 1 FROM public.v_redpay_installverify_pairs LIMIT 1;      -- 컴파일/실행
  PERFORM 1 FROM public.v_redpay_reconciliation_daily LIMIT 1;     -- 컴파일/실행
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='v_redpay_reconciliation_daily'
                   AND column_name='install_verify_presumed') THEN
    RAISE EXCEPTION 'DRYRUN FAIL — install_verify_presumed 컬럼 부재';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='v_redpay_reconciliation_daily'
                   AND column_name='install_verify_evidence') THEN
    RAISE EXCEPTION 'DRYRUN FAIL — install_verify_evidence 컬럼 부재';
  END IF;
  RAISE NOTICE 'DRYRUN OK — 뷰 2종 컴파일/실행/신규컬럼(install_verify_presumed,evidence) 검증 통과';
END $$;

-- 무영속 보장: COMMIT 없음 → 명시 ROLLBACK 으로 전량 폐기.
ROLLBACK;
