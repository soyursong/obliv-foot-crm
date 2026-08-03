-- ══════════════════════════════════════════════════════════════════
-- T-20260803-foot-REDPAY-INSTALLVERIFY-NET0-AUTOCLASSIFY
--   레드페이 대사 '설치검증 추정' net0 쌍 자동 분류 (read-time 파생, 무DDL/무저장)
-- ══════════════════════════════════════════════════════════════════
-- 배경: 설치·단말 검증용 테스트 결제(승인+즉시취소=순액0 소액)가 매일 '이거 뭐냐'
--   확인요청으로 반복 노이즈(07-23 1,004원 TID1047479153: 30분 간격 3회). 최필경 총괄
--   45일 전수분석 → '테스트 거래 확정' → 4조건 ALL 충족 시 자동 '설치검증 추정' 표시.
--
-- ── AC-0 결정축 (db_change:false, 무DDL read-time 파생분류) ────────────────────────
--   신규 저장 테이블/컬럼/enum 0. payments 원장·매출집계·redpay_raw_transactions 무접촉.
--   구현 = read-only VIEW 만(T-20260708-foot-REDPAY-CLOSING-TAB 선례 계승 — CREATE VIEW/FUNC
--   ADDITIVE, 롤백=DROP/RESTORE, base-table 무변경 → 데이터정책 자문 게이트 §S2.4 비대상).
--   ★ 영속 태그/사람 override 이력 = 후속 ADDITIVE(data-architect CONSULT 1차 게이트 선행) — 본 마이그 제외.
--
-- ── AC-0 중복 판정기 방지 (net0 정의 단일화) ─────────────────────────────────────
--   net0 쌍 판정 = (같은 clinic·tid·approval_no, 승인 Y(+) + 즉시취소 N/X/M(−), amount 합=0).
--   재사용 SSOT 스펙 = src/lib/redpayInstallVerify.ts (FE) — 임계 상수 동일 값 미러.
--   CANCELPAIR-FILTER-AUDIT 의 net0 admission(승인+즉시취소) 정의와 정합(별도 판정기 신설 금지).
--
-- ── 자동 분류 4조건 (ALL 충족 시에만) ───────────────────────────────────────────
--   ① 같은 TID·같은 금액·같은 승인번호 net-0 쌍(승인 Y + 즉시취소 N/X/M, amount 합=0)
--   ② 취소가 승인 후 '수십 초 내'(≤ 120초, IMMEDIATE_CANCEL_MAX_SEC)
--   ③ 해당 TID 의 거래가 그 쌍뿐(TID 단독 = 전체 이력에서 정확히 2건)
--       ★ 전체 이력 기준(당일 window 아님) — false-POSITIVE(실거래를 테스트로 오분류→확인큐 은폐)
--         방지가 최우선(GO_WARN). 당일만 보면 다른 날 거래 있는 TID 를 singleton 오판할 위험.
--   ④ 금액이 소액 whitelist (1,004 / 1,000 / 500 / 100원) — dev·총괄 확정 임계
--   ⚠ 4조건 AND. 하나라도 미충족 → 미분류 → 기존 확인요청 플로우 유지.
--
-- ── 별도 네임스페이스 (semantic firewall) ────────────────────────────────────────
--   '설치검증_추정' 분류 라벨은 cross-CRM canonical is_test / is_simulation 과 완전 별도 축
--   (foot 레드페이 대사 표시 전용 read-time 파생). 혼선 금지.
--
-- risk: GO_WARN — read-only view 2종(신규 1 + CREATE OR REPLACE 1). 파괴적 변경 0.
--   base-table/컬럼/제약/트리거/RLS/원장 무접촉. 롤백 = pairs DROP + 대사뷰 이전정의 RESTORE.
-- ══════════════════════════════════════════════════════════════════

-- ============================================================
-- 1. VIEW v_redpay_installverify_pairs — 4조건 ALL 충족 net0 쌍 (분류 엔진, read-only)
--    grain = 자동분류된 쌍 1건 = 1행. 승인행/취소행 raw id 둘 다 노출 + 4조건 evidence.
--    security_invoker: 호출자 clinic RLS 적용(FE). 폴러(service_role)는 RLS 바이패스.
-- ============================================================
CREATE OR REPLACE VIEW public.v_redpay_installverify_pairs
WITH (security_invoker = true) AS
WITH foot_raw AS (
  -- 풋 스코프 = 대사뷰(v_redpay_reconciliation_daily)와 동일 registry-파생 필터 + tid/merchant COALESCE 폴백.
  SELECT
    r.id,
    r.clinic_id,
    COALESCE(r.tid, (r.raw_payload -> 'data'::text) ->> 'tid'::text) AS tid,
    r.approval_no,
    r.external_status,
    r.amount,
    r.approved_at,
    r.cancelled_at,
    r.external_trxid
  FROM public.redpay_raw_transactions r
  WHERE (COALESCE((r.raw_payload -> 'merchant'::text) ->> 'id'::text, (r.raw_payload -> 'data'::text) ->> 'merchant_id'::text) IN (
           SELECT redpay_terminal_registry.merchant_id
             FROM public.redpay_terminal_registry
            WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active))
    AND (COALESCE(r.tid, (r.raw_payload -> 'data'::text) ->> 'tid'::text) IN (
           SELECT redpay_terminal_registry.tid
             FROM public.redpay_terminal_registry
            WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.tid IS NOT NULL
           UNION
           SELECT unnest(redpay_terminal_registry.superseded_tids)
             FROM public.redpay_terminal_registry
            WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active AND redpay_terminal_registry.superseded_tids IS NOT NULL))
),
tid_counts AS (
  -- ③ TID 단독 판정용: 해당 (clinic, tid) 의 전체 이력 거래 수(당일 아님).
  SELECT clinic_id, tid, count(*) AS n
  FROM foot_raw
  WHERE tid IS NOT NULL
  GROUP BY clinic_id, tid
),
pairs AS (
  -- ① 같은 clinic·tid·approval_no, 승인 Y(+) + 즉시취소 N/X/M(−), amount 합=0(net0).
  SELECT
    a.clinic_id,
    a.tid,
    a.approval_no,
    a.id                                     AS approval_row_id,
    c.id                                     AS cancel_row_id,
    a.external_trxid                         AS approval_trxid,
    c.external_trxid                         AS cancel_trxid,
    a.amount                                 AS approval_amount,
    c.amount                                 AS cancel_amount,
    a.approved_at                            AS approval_at,
    COALESCE(c.cancelled_at, c.approved_at)  AS cancel_at,
    EXTRACT(EPOCH FROM (COALESCE(c.cancelled_at, c.approved_at) - a.approved_at)) AS gap_sec
  FROM foot_raw a
  JOIN foot_raw c
    ON  c.clinic_id   = a.clinic_id
    AND c.tid         = a.tid
    AND c.approval_no = a.approval_no
  WHERE a.tid IS NOT NULL
    AND a.approval_no IS NOT NULL
    AND a.external_status = 'Y'  AND a.amount > 0
    AND c.external_status = ANY (ARRAY['N'::text, 'X'::text, 'M'::text]) AND c.amount < 0
    AND (a.amount + c.amount) = 0                        -- net0 = 같은 금액(절대값) 상쇄
    AND a.approved_at IS NOT NULL
    AND COALESCE(c.cancelled_at, c.approved_at) IS NOT NULL
)
SELECT
  p.clinic_id,
  p.tid,
  p.approval_no,
  p.approval_row_id,
  p.cancel_row_id,
  p.approval_trxid,
  p.cancel_trxid,
  p.approval_amount,
  p.cancel_amount,
  p.approval_at,
  p.cancel_at,
  p.gap_sec,
  tc.n                                            AS tid_txn_count,
  (p.approval_at AT TIME ZONE 'Asia/Seoul'::text)::date AS close_date,
  jsonb_build_object(
    'classified',                          '설치검증_추정',
    'cond1_net0_same_tid_amount_approval', true,
    'cond2_cancel_gap_sec',                round(p.gap_sec)::int,
    'cond2_threshold_sec',                 120,
    'cond3_tid_txn_count',                 tc.n,
    'cond4_amount',                        p.approval_amount,
    'approval_trxid',                      p.approval_trxid,
    'cancel_trxid',                        p.cancel_trxid,
    'approval_at',                         p.approval_at,
    'cancel_at',                           p.cancel_at,
    'approval_no',                         p.approval_no,
    'tid',                                 p.tid
  )                                               AS install_verify_evidence
FROM pairs p
JOIN tid_counts tc ON tc.clinic_id = p.clinic_id AND tc.tid = p.tid
WHERE tc.n = 2                                     -- ③ TID 단독(이 쌍뿐)
  AND p.gap_sec >= 0 AND p.gap_sec <= 120          -- ② 승인 후 수십초 내(≤120s)
  AND p.approval_amount IN (100, 500, 1000, 1004); -- ④ 소액 whitelist

COMMENT ON VIEW public.v_redpay_installverify_pairs IS
  'T-20260803-foot-REDPAY-INSTALLVERIFY-NET0-AUTOCLASSIFY: 설치검증 추정 net0 쌍(4조건 ALL). '
  '① net0 쌍(같은 tid·금액·승인번호, 승인+즉시취소 합0) ② 취소 승인후 ≤120초 ③ TID 단독(전체이력 2건) '
  '④ 소액 whitelist(100/500/1000/1004). read-time 파생(무저장) — payments 원장/매출집계 무접촉. '
  'is_test/is_simulation(canonical)과 별도 축(semantic firewall). security_invoker=true → 호출자 clinic RLS.';

GRANT SELECT ON public.v_redpay_installverify_pairs TO authenticated;

-- ============================================================
-- 2. VIEW v_redpay_reconciliation_daily — CREATE OR REPLACE (install_verify 2컬럼 ADDITIVE 말미추가)
--    ★ live 정의(20260724170000 pg dump) verbatim 재현 + 말미 2컬럼(install_verify_presumed,
--      install_verify_evidence) 추가 + Part A LEFT JOIN v_redpay_installverify_pairs.
--      기존 컬럼 순서/조인/필터/security_invoker 전부 불변(회귀 방어). CREATE OR REPLACE 는
--      말미 컬럼 추가만 허용 — 순서 보존.
-- ============================================================
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
        END AS recon_status,
    -- ── ADDITIVE (T-20260803 INSTALLVERIFY): 설치검증 추정 분류 (read-time 파생) ──
    (iv.approval_row_id IS NOT NULL) AS install_verify_presumed,
    iv.install_verify_evidence       AS install_verify_evidence
   FROM redpay_raw_transactions r
     LEFT JOIN payments p ON p.id = r.matched_payment_id
     LEFT JOIN public.v_redpay_installverify_pairs iv
            ON iv.clinic_id = r.clinic_id
           AND (r.id = iv.approval_row_id OR r.id = iv.cancel_row_id)
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
    'missing_at_van'::text AS recon_status,
    -- ADDITIVE: CRM 앵커(missing_at_van)는 분류 비대상.
    false AS install_verify_presumed,
    NULL::jsonb AS install_verify_evidence
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
  'T-20260803-INSTALLVERIFY: install_verify_presumed/evidence 2컬럼 ADDITIVE(설치검증 추정 net0 쌍 read-time 파생, v_redpay_installverify_pairs LEFT JOIN). '
  'security_invoker=true → 호출자 clinic RLS 적용.';

GRANT SELECT ON public.v_redpay_reconciliation_daily TO authenticated;
