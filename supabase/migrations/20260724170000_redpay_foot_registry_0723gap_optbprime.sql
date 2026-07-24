-- ══════════════════════════════════════════════════════════════════
-- T-20260724-foot-REDPAY-WHITELIST-EXPAND-0723GAP — 0723 GAP Opt-B′ (ADDITIVE)
-- ══════════════════════════════════════════════════════════════════
-- 배경(redpay_foot_terminal_registry.md §8 DECISION 2026-07-24):
--   7/23 bizno 511→457 이관 동반 VAN 단말 재프로비저닝으로 foot band 실거래 TID 가
--   registry 보유 TID(구 1047479xxx)와 divergence. 구 TID 는 7/17~ dead 이나 7/11~14 historical
--   raw 21행 보유 → UPDATE-in-place(Opt-A) 시 소비뷰 tid-membership 에서 21행 silent-drop.
--   추가로 merchant 1777285002(풋2 VAN, seed-omission) 미등록으로 7/23 5행 미적재.
--
-- ── 채택 = Opt-B′ (ADDITIVE-only, DA CONSULT-REPLY DA-20260724-foot-REDPAY-0723GAP-EXPAND §8.3) ──
--   원 Opt-B(DROP UNIQUE(merchant_id)→복합) = autonomy §3.1 열거 파괴적(UNIQUE 제거) → 폐기.
--   planner verdict(2026-07-24 09:55, MSG-20260724-095855-7qxt): GO on Opt-B′, 대표 게이트 면제,
--     supervisor DDL-diff 만. 허용 DDL 화이트리스트 = 아래 2건에 한정:
--       (1) `superseded_tids text[]` ADD COLUMN 1건
--       (2) 소비뷰/함수 CREATE OR REPLACE (tid-membership UNION 확장)
--     ⛔ DROP UNIQUE / 제약 widening / 타입변경 / PK변경 전면 금지(스코프 밖).
--
-- ── ADDITIVE 계약 ─────────────────────────────────────────────────────
--   · UNIQUE(merchant_id)·ON CONFLICT(merchant_id) 유지(무접촉).
--   · 신규 컬럼 superseded_tids text[](nullable, default NULL) — 기존행 무영향.
--   · 5 merchant(285001/003/005/006/007): tid=신 live TID 로 UPDATE + 구 TID 를 superseded_tids append.
--   · merchant 285002: 신규 INSERT(tid=신 live 1047535843), ON CONFLICT DO NOTHING(멱등).
--   · 소비뷰/함수 tid-membership = `SELECT tid … UNION SELECT unnest(superseded_tids) …` 확장
--     → 구 TID(historical 21행) + 신 TID(신규) 모두 가시. 동일-또는-상위집합(회귀0, 순소실0).
--   · 무접촉: payments / redpay_raw_transactions / payment_reconciliation_log 원장, RLS, 트리거,
--     UNIQUE 제약, PK, 컬럼 타입. body(도수) registry 행.
--   Rollback: 20260724170000_redpay_foot_registry_0723gap_optbprime.rollback.sql
--     (뷰/함수를 UNION 이전 registry-파생 정의로 복원 + 5 remap 역전 + 285002 DELETE + DROP COLUMN. 데이터손실 0).
--   Dry-run: 20260724170000_redpay_foot_registry_0723gap_optbprime.dryrun.mjs (BEGIN/ROLLBACK 무영속 + post-probe).
--
-- risk: GO(ADDITIVE, 회귀0, 롤백SQL). 대표 게이트 면제(autonomy §3.1). supervisor DDL-diff QA.
-- ══════════════════════════════════════════════════════════════════

-- ============================================================
-- 1. ADD COLUMN superseded_tids text[] (ADDITIVE, nullable)
--    교체된 구 TID 를 보존 → 소비뷰 UNION 으로 historical raw 가시성 유지.
-- ============================================================
ALTER TABLE public.redpay_terminal_registry
  ADD COLUMN IF NOT EXISTS superseded_tids text[];

COMMENT ON COLUMN public.redpay_terminal_registry.superseded_tids IS
  'T-20260724-...-0723GAP: 단말 재프로비저닝(구→신 TID)으로 교체된 구 TID 목록. '
  '소비뷰 tid-membership 이 tid ∪ unnest(superseded_tids) 로 확장되어 historical raw 가 계속 가시. '
  'UNIQUE(merchant_id) 유지(2행 병존 회피) 하의 ADDITIVE 해법(Opt-B′).';

-- ============================================================
-- 2. 5 merchant remap — tid=신 live TID + 구 TID 를 superseded_tids 로 이관 (멱등)
--    §8.1: 285001→845(구255) 003→842(구254) 005→837(구268) 006→835(구262) 007→797(구263).
--    idempotent: superseded 는 DISTINCT 병합 + 신 TID 제외 → 재실행 무해.
-- ============================================================
WITH remap(merchant_id, old_tid, new_tid) AS (
  VALUES
    ('1777285001', '1047479255', '1047535845'),
    ('1777285003', '1047479254', '1047535842'),
    ('1777285005', '1047479268', '1047535837'),
    ('1777285006', '1047479262', '1047535835'),
    ('1777285007', '1047479263', '1047535797')
)
UPDATE public.redpay_terminal_registry t
SET tid = m.new_tid,
    superseded_tids = ARRAY(
      SELECT DISTINCT e
      FROM unnest(COALESCE(t.superseded_tids, '{}'::text[]) || ARRAY[m.old_tid]) AS e
      WHERE e IS NOT NULL AND e <> m.new_tid
    ),
    source = 'redpay_foot_terminal_registry.md §8 (0723 GAP Opt-B′ VAN 재프로비저닝, DA CONSULT-REPLY DA-20260724-foot-REDPAY-0723GAP-EXPAND)',
    verified_at = '2026-07-24T00:00:00+09:00'::timestamptz,
    updated_at = now()
FROM remap m
WHERE t.merchant_id = m.merchant_id
  AND t.domain = 'foot';

-- ============================================================
-- 3. INSERT merchant 285002 (풋2 VAN, 신규 ADDITIVE) — tid=신 live 1047535843
--    §8.2: name 오블리브-서울오리진점 풋2(VAN), band 1777285*(=foot VAN), 285001↔003 seed-omission.
--    멱등: ON CONFLICT(merchant_id) DO NOTHING. clinic = slug('jongno-foot') 정본 링크.
-- ============================================================
INSERT INTO public.redpay_terminal_registry
  (clinic_id, domain, merchant_id, tid, terminal_label, active, source, verified_at)
SELECT
  (SELECT id FROM public.clinics WHERE slug = 'jongno-foot' ORDER BY id LIMIT 1),
  'foot',
  '1777285002',
  '1047535843',
  '풋2(VAN)',
  true,
  'redpay_foot_terminal_registry.md §8.2 (0723 GAP seed-omission 편입, ADDITIVE, DA CONSULT-REPLY DA-20260724-foot-REDPAY-0723GAP-EXPAND)',
  '2026-07-24T00:00:00+09:00'::timestamptz
ON CONFLICT (merchant_id) DO NOTHING;

-- ============================================================
-- 4. 소비뷰/함수 CREATE OR REPLACE — tid-membership UNION 확장 (구 TID + 신 TID 모두 가시)
--    ★ live 정의(pg_get_viewdef, 2026-07-24 dump) 를 verbatim 재현 + tid 서브쿼리에만 UNION 추가.
--      merchant 서브쿼리·컬럼·조인·필터·security_invoker 전부 불변(회귀 방어).
--    UNION 패턴(전 소비처 동일):
--      SELECT tid FROM registry WHERE foot AND active AND tid IS NOT NULL
--      UNION
--      SELECT unnest(superseded_tids) FROM registry WHERE foot AND active AND superseded_tids IS NOT NULL
-- ============================================================

-- 4a. VIEW v_redpay_reconciliation_daily (일마감 레드페이 하위탭 read-only 대조)
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
          WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active))
    AND (COALESCE(r.tid, (r.raw_payload -> 'data'::text) ->> 'tid'::text) IN (
           SELECT redpay_terminal_registry.tid
             FROM redpay_terminal_registry
            WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.tid IS NOT NULL
           UNION
           SELECT unnest(redpay_terminal_registry.superseded_tids)
             FROM redpay_terminal_registry
            WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.superseded_tids IS NOT NULL))
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
                  WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active))
            AND (COALESCE(r2.tid, (r2.raw_payload -> 'data'::text) ->> 'tid'::text) IN (
                   SELECT redpay_terminal_registry.tid
                     FROM redpay_terminal_registry
                    WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.tid IS NOT NULL
                   UNION
                   SELECT unnest(redpay_terminal_registry.superseded_tids)
                     FROM redpay_terminal_registry
                    WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.superseded_tids IS NOT NULL))
            AND (r2.approved_at AT TIME ZONE 'Asia/Seoul'::text)::date = (p.created_at AT TIME ZONE 'Asia/Seoul'::text)::date));

COMMENT ON VIEW public.v_redpay_reconciliation_daily IS
  'T-20260708-foot-REDPAY-CLOSING-TAB: 일마감 레드페이 하위탭 read-only 대조 뷰. '
  'redpay 승인 1건=1행(풋 merchant_id 1차 권위 + TID 보조, redpay_terminal_registry SSOT 파생) + missing_at_van(당일 raw EXISTS 가드). '
  'T-20260724-...-0723GAP Opt-B′: tid-membership = tid ∪ unnest(superseded_tids) (재프로비저닝 구·신 TID 모두 가시). '
  'security_invoker=true → 호출자 clinic RLS 적용.';

GRANT SELECT ON public.v_redpay_reconciliation_daily TO authenticated;

-- 4b. VIEW v_receipt_settlement_daily (영수증 OCR ↔ 레드페이 정산 대조)
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
                  WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active))
            AND (COALESCE(r2.tid, (r2.raw_payload -> 'data'::text) ->> 'tid'::text) IN (
                   SELECT redpay_terminal_registry.tid
                     FROM redpay_terminal_registry
                    WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.tid IS NOT NULL
                   UNION
                   SELECT unnest(redpay_terminal_registry.superseded_tids)
                     FROM redpay_terminal_registry
                    WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.superseded_tids IS NOT NULL))) AS redpay_feed_last_approved_at
   FROM payments p
     JOIN customers c ON c.id = p.customer_id
     LEFT JOIN redpay_raw_transactions rp ON rp.matched_payment_id = p.id AND (COALESCE((rp.raw_payload -> 'merchant'::text) ->> 'id'::text, (rp.raw_payload -> 'data'::text) ->> 'merchant_id'::text) IN ( SELECT redpay_terminal_registry.merchant_id
           FROM redpay_terminal_registry
          WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active))
       AND (COALESCE(rp.tid, (rp.raw_payload -> 'data'::text) ->> 'tid'::text) IN (
              SELECT redpay_terminal_registry.tid
                FROM redpay_terminal_registry
               WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.tid IS NOT NULL
              UNION
              SELECT unnest(redpay_terminal_registry.superseded_tids)
                FROM redpay_terminal_registry
               WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.superseded_tids IS NOT NULL))
     LEFT JOIN LATERAL ( SELECT rl2.event_type,
            rl2.mismatch_reason
           FROM payment_reconciliation_log rl2
          WHERE rl2.payment_id = p.id
          ORDER BY rl2.created_at DESC
         LIMIT 1) rl ON true
  WHERE p.image_url IS NOT NULL AND p.payment_type = 'payment'::text AND COALESCE(p.status, ''::text) <> 'deleted'::text;

COMMENT ON VIEW public.v_receipt_settlement_daily IS
  'T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH: 영수증 OCR ↔ 레드페이 정산 대조(read-only). '
  '풋 merchant_id 1차 권위 + TID 보조 = redpay_terminal_registry SSOT 파생. '
  'T-20260724-...-0723GAP Opt-B′: tid-membership = tid ∪ unnest(superseded_tids). security_invoker=true.';

GRANT SELECT ON public.v_receipt_settlement_daily TO authenticated;

-- 4c. FUNC get_redpay_feed_freshness() (적재 freshness, AC-7)
CREATE OR REPLACE FUNCTION public.get_redpay_feed_freshness()
RETURNS TABLE(last_approved_at timestamp with time zone, last_raw_updated_at timestamp with time zone, last_incremental_to timestamp with time zone, raw_count_today bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()
  ),
  foot_merchants AS (   -- 1차 권위: 풋 merchant_id (registry SSOT 파생)
    SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
  ),
  foot_tids AS (        -- belt-and-suspenders: 풋 TID (registry SSOT 파생 + superseded UNION)
    SELECT tid FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active AND tid IS NOT NULL
    UNION
    SELECT unnest(superseded_tids) FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active AND superseded_tids IS NOT NULL
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

COMMENT ON FUNCTION public.get_redpay_feed_freshness() IS
  'T-20260708-foot-REDPAY-CLOSING-TAB AC-7: 레드페이 적재 freshness. '
  '풋 화이트리스트 = redpay_terminal_registry SSOT 파생(tid ∪ superseded_tids, T-20260724-...-0723GAP). '
  '"거래 없음" vs "적재 死" 현장 구분용. SECURITY DEFINER, 호출자 clinic 스코프.';

GRANT EXECUTE ON FUNCTION public.get_redpay_feed_freshness() TO authenticated;

-- ── 원장 기록 ──
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260724170000', 'redpay_foot_registry_0723gap_optbprime')
ON CONFLICT (version) DO NOTHING;

-- ── 적용 검증 쿼리 (참고) ──────────────────────────────────────────────────
-- SELECT domain, count(*) FROM public.redpay_terminal_registry WHERE active GROUP BY 1;  -- foot=27, body=14 기대
-- SELECT merchant_id, tid, superseded_tids FROM public.redpay_terminal_registry
--   WHERE domain='foot' AND merchant_id IN
--     ('1777285001','1777285002','1777285003','1777285005','1777285006','1777285007') ORDER BY merchant_id;
