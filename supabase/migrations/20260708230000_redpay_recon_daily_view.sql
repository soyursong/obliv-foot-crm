-- ══════════════════════════════════════════════════════════════════
-- T-20260708-foot-REDPAY-CLOSING-TAB — 일마감 '레드페이' 하위탭 read-layer
-- ══════════════════════════════════════════════════════════════════
-- DA CONSULT-REPLY(MSG-20260708-195301-fjc6, GO_WARN):
--   신규 저장 테이블/컬럼 0. raw SSOT = 기존 redpay_raw_transactions(PORT 이식).
--   대조 = read-only VIEW v_redpay_reconciliation_daily(FE 조인·FE 매칭 재계산 금지).
--   ADDITIVE-ONLY = CREATE VIEW/FUNC 만. 롤백 = DROP VIEW/FUNCTION.
--
-- 본 마이그 산출물(둘 다 신규·additive):
--   1. VIEW  public.v_redpay_reconciliation_daily  (security_invoker — 호출자 RLS 적용)
--   2. FUNC  public.get_redpay_feed_freshness()     (SECURITY DEFINER — 적재 freshness)
--
-- 무접촉 대상(변경 0): payments / redpay_raw_transactions / payment_reconciliation_log /
--   redpay_poller_state 의 컬럼·제약·트리거·RLS·원장. 기존 4-tier 매처(EF) 무변경.
--
-- AC-1: 신규 저장 DDL 0. 매칭 결과는 이미 redpay_raw_transactions.matched_payment_id
--       (PORT 매처가 read-only 기록)에 존재 → 뷰는 그 상태를 표면화만.
-- AC-3: recon_status 파생 = matched / missing_in_crm / missing_at_van /
--       amount_mismatch / refund_not_in_crm (recon_log 4종 enum 동일 집합).
-- AC-4: ⚠ business_no 511-60-00988 = 5도메인 공유(풋/도수/피부/롱래스팅 동거).
--       [2026-07-11 피벗 REDPAY-MACSTUDIO-POLLER + DA GO] 권위 키 = merchant_id(도메인 경계).
--       → 뷰 1차 판정 = raw_payload->merchant->>id IN (풋 merchant_id 26). TID 17 은 belt-and-suspenders 보조.
--       도수/피부/롱레는 merchant 대역 밖 → 구조적 자동배제. clinic_id(RLS)=테넌트 계정 스코프. 삼중 방어.
--       SSOT = memory/1_Projects/201_메디빌더_AI도입/redpay_foot_terminal_registry.md §2 (authoritative).
-- AC-7: 적재 freshness(마지막 approved_at + 폴러 last_incremental_to) 노출 →
--       "거래 없음"(폴러 정상·raw 0) vs "적재 死"(폴러 stale) 를 현장이 구분.
--       missing_at_van 오탐 방지: 해당 일자 raw 존재(EXISTS) 시에만 산출.
--
-- risk: GO_WARN — 검증된 PORT 인프라 위 read-only view/func. 파괴적 변경 0.
-- ══════════════════════════════════════════════════════════════════

-- ── 풋 스코프 화이트리스트 (redpay_foot_terminal_registry.md §2 = authoritative) ──────
--   1차 권위 = merchant_id 17종(VAN2·1777285* / 유선2·1777288* / 멀티·무선13·1777289*).
--   보조 = TID 17종(merchant 1:1). env REDPAY_MERCHANT_WHITELIST/REDPAY_TID_WHITELIST(폴러) 와 동일 집합.
--   뷰는 서버-권위로 하드코딩. fast-follow(§6): DB 레지스트리 테이블 SSOT 로 단일화 예정(별도 P1).

-- ============================================================
-- 1. VIEW v_redpay_reconciliation_daily — CRM ↔ 레드페이 대조 (read-only)
--    grain = 레드페이 승인 1건 = 1행 (redpay-anchored) + missing_at_van(crm-anchored)
--    FE 는 이 뷰만 소비(FE 조인/매칭 재계산 금지).
-- ============================================================
CREATE OR REPLACE VIEW public.v_redpay_reconciliation_daily
WITH (security_invoker = true) AS
-- Part A: 레드페이 raw(풋 TID) 앵커 — matched / amount_mismatch / missing_in_crm / refund_not_in_crm
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
WHERE (r.raw_payload->'merchant'->>'id') IN (   -- 1차 권위: 풋 merchant_id 26(도메인 경계)
  '1777285001','1777285003','1777285004','1777285005','1777285006',
  '1777285007','1777285008','1777288001','1777288003','1777288004',
  '1777288005','1777288006','1777288008','1777289001','1777289002',
  '1777289003','1777289004','1777289005','1777289006','1777289007',
  '1777289008','1777289009','1777289010','1777289011','1777289012',
  '1777289013'
)
AND r.tid IN (                                  -- belt-and-suspenders: 풋 TID 26(merchant 1:1)
  '1047479255','1047479254','1047479261','1047479268','1047479262',
  '1047479263','1047479264','1047479469','1047479471','1047479472',
  '1047479473','1047479474','1047479475','1047479483','1047479476',
  '1047479477','1047479478','1047479479','1047479480','1047479481',
  '1047479482','1047479153','1047479148','1047479155','1047479158',
  '1047479157'
)

UNION ALL

-- Part B: CRM 카드결제 앵커 — missing_at_van (단말기 raw 없음)
--   AC-7 오탐 방지: 같은 일자에 풋 raw 가 EXISTS 할 때만 산출(빈 피드→전건 missing 오표시 차단).
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
      AND (r2.raw_payload->'merchant'->>'id') IN (   -- 1차 권위: 풋 merchant_id 26
        '1777285001','1777285003','1777285004','1777285005','1777285006',
        '1777285007','1777285008','1777288001','1777288003','1777288004',
        '1777288005','1777288006','1777288008','1777289001','1777289002',
        '1777289003','1777289004','1777289005','1777289006','1777289007',
        '1777289008','1777289009','1777289010','1777289011','1777289012',
        '1777289013'
      )
      AND r2.tid IN (                                -- belt-and-suspenders: 풋 TID 26
        '1047479255','1047479254','1047479261','1047479268','1047479262',
        '1047479263','1047479264','1047479469','1047479471','1047479472',
        '1047479473','1047479474','1047479475','1047479483','1047479476',
        '1047479477','1047479478','1047479479','1047479480','1047479481',
        '1047479482','1047479153','1047479148','1047479155','1047479158',
        '1047479157'
      )
      AND (r2.approved_at AT TIME ZONE 'Asia/Seoul')::date
          = (p.created_at AT TIME ZONE 'Asia/Seoul')::date
  );

COMMENT ON VIEW public.v_redpay_reconciliation_daily IS
  'T-20260708-foot-REDPAY-CLOSING-TAB: 일마감 레드페이 하위탭 read-only 대조 뷰. '
  'redpay 승인 1건=1행(풋 merchant_id 26 1차 권위 + TID 17 보조 필터) + missing_at_van(당일 raw EXISTS 가드). '
  'recon_status ∈ matched/missing_in_crm/missing_at_van/amount_mismatch/refund_not_in_crm. '
  'FE 는 이 뷰만 소비 — FE 조인/매칭 재계산 금지(매처 진실원천 이중화 방지). '
  'security_invoker=true → 호출자 clinic RLS 적용.';

GRANT SELECT ON public.v_redpay_reconciliation_daily TO authenticated;

-- ============================================================
-- 2. FUNC get_redpay_feed_freshness() — 적재 freshness (AC-7)
--    SECURITY DEFINER: redpay_poller_state(service_role RLS)를 안전 read.
--    반환값 = 비-PII 타임스탬프/카운트만. 호출자 clinic 스코프.
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
  foot_merchants AS (   -- 1차 권위: 풋 merchant_id 26(도메인 경계)
    SELECT unnest(ARRAY[
      '1777285001','1777285003','1777285004','1777285005','1777285006',
      '1777285007','1777285008','1777288001','1777288003','1777288004',
      '1777288005','1777288006','1777288008','1777289001','1777289002',
      '1777289003','1777289004','1777289005','1777289006','1777289007',
      '1777289008','1777289009','1777289010','1777289011','1777289012',
      '1777289013'
    ]) AS merchant_id
  ),
  foot_tids AS (        -- belt-and-suspenders: 풋 TID 26(merchant 1:1)
    SELECT unnest(ARRAY[
      '1047479255','1047479254','1047479261','1047479268','1047479262',
      '1047479263','1047479264','1047479469','1047479471','1047479472',
      '1047479473','1047479474','1047479475','1047479483','1047479476',
      '1047479477','1047479478','1047479479','1047479480','1047479481',
      '1047479482','1047479153','1047479148','1047479155','1047479158',
      '1047479157'
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

COMMENT ON FUNCTION public.get_redpay_feed_freshness() IS
  'T-20260708-foot-REDPAY-CLOSING-TAB AC-7: 레드페이 적재 freshness. '
  'last_approved_at=마지막 승인거래 시각, last_incremental_to=폴러 마지막 성공 to. '
  '"거래 없음" vs "적재 死" 현장 구분용. SECURITY DEFINER(poller_state 안전 read), 호출자 clinic 스코프.';

GRANT EXECUTE ON FUNCTION public.get_redpay_feed_freshness() TO authenticated;
