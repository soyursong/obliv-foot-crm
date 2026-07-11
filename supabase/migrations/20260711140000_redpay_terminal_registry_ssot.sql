-- ══════════════════════════════════════════════════════════════════
-- T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE — 레드페이 단말 화이트리스트 SSOT 테이블화
-- ══════════════════════════════════════════════════════════════════
-- 배경(redpay_foot_terminal_registry.md §5): 풋 17-set 화이트리스트가 현재 8곳에 하드코딩
--   복제 → 다음 단말 추가 시 일부만 갱신 = drift(이번 fetched=0 사고의 구조적 원인).
-- DA CONSULT-REPLY(MSG-20260711-094634-tjtk §6, GO_WARN)가 ADDITIVE 레지스트리 테이블을
--   fast-follow 로 권고: 신설 → 뷰는 JOIN, 폴러는 조회, env/하드코딩은 파생.
--   + "미분류 merchant under 511-60-00988" 알람(신규 단말 자동 표면화, silent include/drop 금지).
-- authoritative SSOT: memory/1_Projects/201_메디빌더_AI도입/redpay_foot_terminal_registry.md §2
--   (owner=DA, last_verified 2026-07-11, foot 17-set = merchant_id:tid 1:1).
--
-- ── ADDITIVE 계약 ─────────────────────────────────────────────────────
--   신규: TABLE redpay_terminal_registry (+seed 17) / VIEW v_redpay_unclassified_merchants.
--   재정의(CREATE OR REPLACE, 동일 결과): v_redpay_reconciliation_daily / v_receipt_settlement_daily /
--     get_redpay_feed_freshness() — 하드코딩 IN(17) → 테이블 서브쿼리 파생으로 전환.
--   seed = registry §2 의 정확한 17-set → 전환 전후 필터 결과 100% 동일(회귀 0. dryrun 대조).
--   무접촉: payments / redpay_raw_transactions / payment_reconciliation_log / redpay_poller_state
--     의 컬럼·제약·트리거·RLS·원장. 기존 4-tier 매처(EF) 무변경.
--   Rollback: 20260711140000_redpay_terminal_registry_ssot.rollback.sql
--     (뷰/함수를 하드코딩 17-set 정의로 복원 + DROP TABLE + DROP 알람뷰. 데이터손실 0).
--
-- risk: GO_WARN(DA) — ADDITIVE 이지만 8곳 소비처 중 DB 3곳(뷰2·함수1)을 테이블 파생으로 재배선.
--   회귀 방어 = seed 정확일치 + dryrun 17-set 동일결과 대조 + '미분류 merchant' 알람.
-- ══════════════════════════════════════════════════════════════════

-- ============================================================
-- 1. TABLE redpay_terminal_registry — 레드페이 단말 화이트리스트 SSOT (ADDITIVE 신설)
--    스키마 = DA CONSULT-REPLY §6 확정 8컬럼. 도메인 경계 권위 키 = merchant_id.
--    cross-domain 대응(clinic_id/domain) — 향후 도수/피부/롱레 seed 흡수 가능(별도 티켓).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.redpay_terminal_registry (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      uuid,                              -- 테넌트 스코프(RLS 앵커). 도메인 경계는 merchant_id 가 1차.
  domain         text        NOT NULL,              -- foot | body | derm | longre (가맹점명 기준 도메인)
  merchant_id    text        NOT NULL,              -- ★1차 권위 키(도메인 경계). redpay merchant 전역 유일.
  tid            text,                              -- 보조(belt-and-suspenders). merchant:tid = 1:1(풋).
  terminal_label text,                              -- 풋(VAN)/풋(유선)/풋(멀티)/풋(무선) 등 사람용 라벨
  active         boolean     NOT NULL DEFAULT true, -- false = 폐기/교체 단말(화이트리스트 자동 제외)
  source         text,                              -- 근거 출처(레지스트리 문서·검증 방법)
  verified_at    timestamptz,                       -- prod 실측 검증 시각
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT redpay_terminal_registry_merchant_uk UNIQUE (merchant_id)   -- merchant 전역 유일 → 멱등 seed
);

CREATE INDEX IF NOT EXISTS idx_redpay_terminal_registry_domain_active
  ON public.redpay_terminal_registry (domain, active);

COMMENT ON TABLE public.redpay_terminal_registry IS
  'T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE: 레드페이 단말 화이트리스트 SSOT. '
  'redpay_foot_terminal_registry.md §2(authoritative) 의 8곳-복제를 단일화. '
  '권위 키=merchant_id(도메인 경계). 뷰/함수/폴러가 이 테이블에서 파생(하드코딩 금지). '
  'active=false 는 화이트리스트 자동 제외. cross-domain(clinic_id/domain) — 도메인 확장은 별도 seed.';
COMMENT ON COLUMN public.redpay_terminal_registry.merchant_id IS
  '1차 권위 키(도메인 경계). raw_payload->merchant->>id 와 대조. redpay 전역 유일(UNIQUE).';
COMMENT ON COLUMN public.redpay_terminal_registry.tid IS
  '보조 필터(belt-and-suspenders) + 폴러 서버측 tid= narrowing. merchant 1:1.';
COMMENT ON COLUMN public.redpay_terminal_registry.active IS
  'true=유효 단말. false=폐기/교체 단말(뷰·폴러 화이트리스트에서 자동 제외).';

-- ── RLS: 화이트리스트=비민감 설정 데이터. authenticated read-all(security_invoker 뷰 소비 위해 필요).
--        write 는 service_role(RLS 우회) 전용 = 폴러/마이그레이션만 변경.
ALTER TABLE public.redpay_terminal_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS redpay_terminal_registry_read_all ON public.redpay_terminal_registry;
CREATE POLICY redpay_terminal_registry_read_all
  ON public.redpay_terminal_registry FOR SELECT USING (true);

GRANT SELECT ON public.redpay_terminal_registry TO authenticated;

-- ============================================================
-- 2. SEED — 풋 17-set (redpay_foot_terminal_registry.md §2 authoritative, prod 실측 2026-04~07)
--    멱등: ON CONFLICT(merchant_id) DO NOTHING. clinic_id = business_no 511-60-00988 클리닉(best-effort).
-- ============================================================
WITH foot_clinic AS (
  SELECT id AS clinic_id
  FROM public.clinics
  WHERE business_no = '511-60-00988'
  ORDER BY id
  LIMIT 1
),
seed(merchant_id, tid, terminal_label) AS (
  VALUES
    ('1777285001', '1047479255', '풋(VAN)'),
    ('1777285004', '1047479261', '풋(VAN)'),
    ('1777288001', '1047479469', '풋(유선)'),
    ('1777288004', '1047479472', '풋(유선)'),
    ('1777289001', '1047479483', '풋(멀티)'),
    ('1777289002', '1047479476', '풋(멀티)'),
    ('1777289003', '1047479477', '풋(멀티)'),
    ('1777289004', '1047479478', '풋(멀티)'),
    ('1777289005', '1047479479', '풋(멀티)'),
    ('1777289006', '1047479480', '풋(멀티)'),
    ('1777289007', '1047479481', '풋(멀티)'),
    ('1777289008', '1047479482', '풋(멀티)'),
    ('1777289009', '1047479153', '풋(무선)'),
    ('1777289010', '1047479148', '풋(무선)'),
    ('1777289011', '1047479155', '풋(무선)'),
    ('1777289012', '1047479158', '풋(무선)'),
    ('1777289013', '1047479157', '풋(무선)')
)
INSERT INTO public.redpay_terminal_registry
  (clinic_id, domain, merchant_id, tid, terminal_label, active, source, verified_at)
SELECT
  fc.clinic_id,
  'foot',
  s.merchant_id,
  s.tid,
  s.terminal_label,
  true,
  'redpay_foot_terminal_registry.md §2 (authoritative, DA read-only prod probe, last_verified 2026-07-11)',
  '2026-07-11T00:00:00+09:00'::timestamptz
FROM seed s
LEFT JOIN foot_clinic fc ON true
ON CONFLICT (merchant_id) DO NOTHING;

-- ============================================================
-- 3. 소비처 재배선 — 뷰/함수를 테이블 파생으로 전환 (하드코딩 IN(17) 제거)
--    seed=정확한 17-set → 필터 결과 100% 동일(회귀 0). dryrun 대조로 검증.
-- ============================================================

-- 3a. VIEW v_redpay_reconciliation_daily — 하드코딩 merchant/tid IN(17) → 레지스트리 서브쿼리 파생
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
WHERE (r.raw_payload->'merchant'->>'id') IN (   -- 1차 권위: 풋 merchant_id (registry SSOT 파생)
  SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
)
AND r.tid IN (                                  -- belt-and-suspenders: 풋 TID (registry SSOT 파생)
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
      AND (r2.raw_payload->'merchant'->>'id') IN (   -- 1차 권위: 풋 merchant_id (registry SSOT 파생)
        SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
      )
      AND r2.tid IN (                                -- belt-and-suspenders: 풋 TID (registry SSOT 파생)
        SELECT tid FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active AND tid IS NOT NULL
      )
      AND (r2.approved_at AT TIME ZONE 'Asia/Seoul')::date
          = (p.created_at AT TIME ZONE 'Asia/Seoul')::date
  );

COMMENT ON VIEW public.v_redpay_reconciliation_daily IS
  'T-20260708-foot-REDPAY-CLOSING-TAB (T-20260711 registry 파생 전환): 일마감 레드페이 하위탭 read-only 대조 뷰. '
  'redpay 승인 1건=1행(풋 merchant_id 1차 권위 + TID 보조, redpay_terminal_registry SSOT 파생) + missing_at_van(당일 raw EXISTS 가드). '
  'recon_status ∈ matched/missing_in_crm/missing_at_van/amount_mismatch/refund_not_in_crm. '
  'FE 는 이 뷰만 소비 — FE 조인/매칭 재계산 금지. security_invoker=true → 호출자 clinic RLS 적용.';

GRANT SELECT ON public.v_redpay_reconciliation_daily TO authenticated;

-- 3b. FUNC get_redpay_feed_freshness() — foot_merchants/foot_tids CTE 를 테이블 파생으로 전환
--     SECURITY DEFINER → registry 를 owner 권한 read(RLS 우회). 반환값=비-PII 타임스탬프/카운트.
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

COMMENT ON FUNCTION public.get_redpay_feed_freshness() IS
  'T-20260708-foot-REDPAY-CLOSING-TAB AC-7 (T-20260711 registry 파생 전환): 레드페이 적재 freshness. '
  'last_approved_at=마지막 승인거래 시각, last_incremental_to=폴러 마지막 성공 to. '
  '풋 화이트리스트 = redpay_terminal_registry SSOT 파생. "거래 없음" vs "적재 死" 현장 구분용. '
  'SECURITY DEFINER(poller_state 안전 read), 호출자 clinic 스코프.';

GRANT EXECUTE ON FUNCTION public.get_redpay_feed_freshness() TO authenticated;

-- 3c. VIEW v_receipt_settlement_daily — freshness 서브쿼리 + rp 조인 필터를 테이블 파생으로 전환
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
       AND (r2.raw_payload->'merchant'->>'id') IN (   -- 1차 권위: 풋 merchant_id (registry SSOT 파생)
         SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
       )
       AND r2.tid IN (                                 -- belt-and-suspenders: 풋 TID (registry SSOT 파생)
         SELECT tid FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active AND tid IS NOT NULL
       ))                                                     AS redpay_feed_last_approved_at
FROM public.payments p
JOIN public.customers c ON c.id = p.customer_id
LEFT JOIN public.redpay_raw_transactions rp
       ON rp.matched_payment_id = p.id
      AND (rp.raw_payload->'merchant'->>'id') IN (            -- 1차 권위: 풋 merchant_id (registry SSOT 파생)
        SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
      )
      AND rp.tid IN (                                         -- belt-and-suspenders: 풋 TID (registry SSOT 파생)
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
  'T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD (T-20260711 registry 파생 전환): [영수증 수납] 탭 read-only 대조 뷰. '
  'grain=OCR 영수증 첨부 수납 1건=1행. ★매칭 재계산 없음 — 매처(EF)가 영속화한 결과 surface only. '
  '풋 merchant_id 1차 권위 + TID 보조 = redpay_terminal_registry SSOT 파생. §789 freshness 노출. '
  'match_status ∈ matched/unmatched. FE 는 이 뷰만 소비. security_invoker=true.';

GRANT SELECT ON public.v_receipt_settlement_daily TO authenticated;

-- ============================================================
-- 4. 알람 — "미분류 merchant under 511-60-00988" (신규/미등록 단말 표면화, silent include/drop 금지)
--    redpay_raw_transactions 는 폴러가 business_no 511-60-00988 스코프로 적재 →
--    그 안에서 registry 에 없는 merchant = 미분류/신규 단말 후보. 행이 있으면 registry 갱신 필요.
--    (폴러 ingest-time [UNCLASSIFIED-MERCHANT] 로그와 이중 방어 — 여기는 영속 SSOT 알람.)
--    도메인 확장 시(body/derm/longre seed) 자동으로 '타도메인 분류됨' → 알람에서 자동 이탈.
-- ============================================================
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

COMMENT ON VIEW public.v_redpay_unclassified_merchants IS
  'T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE 알람: business_no 511-60-00988 피드 중 '
  'redpay_terminal_registry(active) 에 없는 merchant = 미분류/신규 단말 후보(silent include/drop 금지). '
  '행 존재 = registry 갱신 필요 신호. 도메인 확장 seed 시 자동 이탈. security_invoker=true.';

GRANT SELECT ON public.v_redpay_unclassified_merchants TO authenticated;

-- 원장 기록 (schema_migrations ledger — 재실행 시 충돌 무시)
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260711140000', 'redpay_terminal_registry_ssot')
ON CONFLICT (version) DO NOTHING;
