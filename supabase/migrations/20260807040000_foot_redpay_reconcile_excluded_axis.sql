-- ══════════════════════════════════════════════════════════════════
-- T-20260806-foot-TESTTID-479470-PERSEAT-REGISTER-ENABLE (AC-3)
--   정산-스코프 배제 축 신설(reconcile_excluded) + 시험단말 TID 1047479470 편입
--   DA verdict = DA-20260806-foot-TESTTID-479470 CONSULT-REPLY(MSG-20260806-234359-634d)
--     정본: da_replies/da_decision_foot_testtid_479470_perseat_register_enable_20260806.md
--     registry SSOT §15: redpay_foot_terminal_registry.md
-- ══════════════════════════════════════════════════════════════════
-- 배경(AC-1 census): registry active=true 하나가 이중임무 겸직 —
--   (a) 운영 authority: #1 PERSEAT 게이트 선택 + #2 Plan-B 카드결제 기록(record_planb_card_payment).
--   (b) 정산 스코프 멤버십: #3 reconcile matcher · #4 v_redpay_reconciliation_daily 뷰 ·
--       #5 미등록회선 digest · #6 v_redpay_installverify_pairs · #7 A11/A12 probe(DA lane).
--   470(구 bizno 511-60-00988·RedPay 전기간 조회 0=정산 오염 0)의 요구 = (a)∈470, (b)∉470.
--   active=true 단독으로 편입 시 게이트/결제 편입과 동시에 정산 소비처 전부 자동편입 →
--   부모 REDPAY-INVISIBLE 봉인 '정산 사각 오경보' 재생산.
--
-- ── 저장방식 = (A) 신규 nullable boolean reconcile_excluded(default false) [DA GO·ADDITIVE] ──
--   active 축(운영 authority)과 직교한 신규 축(정산 스코프 배제). 이름 is_test 재사용 금지
--   (body customer-grain is_test 와 conflation 방지 = axis firewall). test-ness=provenance 는
--   source 컬럼(왜 배제하나), reconcile 배제=operational effect 는 신규 컬럼(무엇을 배제하나) 분리.
--
-- ── 격리 2축 (단일 컬럼이 소비처별 술어로 집행) ──
--   (축1) enumeration: #4 뷰·#6 installverify·#5 digest·#7 probe = 470 '예상단말' 열거 안 함.
--   (축2) matching:    #3 matcher·#6 installverify = 470-payment 매칭배제/미-flag.
--   집행술어 = AND NOT COALESCE(reconcile_excluded, false) (기존행 false/null → 정산 스코프 유지 = 회귀 0).
--
-- ── firewall HARD (VG2) — 본 마이그가 무접촉하는 것 ──
--   #1 게이트(src/lib/cband/tidRegistryGate.ts)·#2 record_planb_card_payment/pkglink MERNO 술어 =
--   여전히 active=true 만(reconcile_excluded 진입 0). 470 active=true → 선택가능 + 결제기록.
--   ★#2 record_planb_card_payment = §4-1c 계약자산 RPC(C19 md5 pin v2.14) → body 무변경 → C19 re-pin 불요.
--   webhook admit(ingress authority)·redpay-webhook = 정산 enumeration/matching 소비처 아님 → 무접촉.
--
-- change-class = ADDITIVE(nullable 컬럼 ADD + read-path 술어 추가 + 단일행 seed) → §3.1 대표게이트 면제.
--   잔여 = supervisor DDL-diff/MIG-GATE + read-path 완전성(VG1) + 단일행 seed write-correctness(VG4).
-- 시퀀싱: supervisor 는 본 마이그(컬럼 착지) 적용 AFTER 에 EF(redpay-reconcile/redpay-unreg-digest)
--   재배포(EF 가 신규 컬럼 select → 컬럼 부재 시 registry 조회 오류 → EF fail-safe 폴백이나 무의미 회피).
-- Rollback : 20260807040000_..._axis.rollback.sql (470 DELETE + DROP COLUMN + 뷰 이전정의 RESTORE, 손실 0).
-- Dry-run  : 20260807040000_..._axis.dryrun.mjs (archive-first + BEGIN/sentinel 무영속 + rows-affected==1 assert).
-- ══════════════════════════════════════════════════════════════════

-- ============================================================
-- 1. ADD COLUMN reconcile_excluded — 정산-스코프 배제 축(nullable default false, ADDITIVE)
--    기존 전 프로덕션 단말 → false(fast default backfill) → 정산 스코프 유지 = 회귀 0(VG3).
-- ============================================================
ALTER TABLE public.redpay_terminal_registry
  ADD COLUMN IF NOT EXISTS reconcile_excluded boolean DEFAULT false;

COMMENT ON COLUMN public.redpay_terminal_registry.reconcile_excluded IS
  'T-20260806-TESTTID-479470 / DA-20260806-foot-TESTTID-479470: 정산-스코프 배제 축(active 와 직교). '
  'true = 운영 authority(#1 게이트·#2 결제)에는 편입하되 정산/대사 소비처(#3 matcher·#4 대사뷰·#5 digest·'
  '#6 installverify·#7 A11/A12 probe)에서는 배제. 집행술어=AND NOT COALESCE(reconcile_excluded,false). '
  'default false → 기존 전 단말 정산 스코프 유지(회귀 0). is_test(body customer-grain) 와 별도 축(축 conflation 금지).';

-- ============================================================
-- 2. VIEW v_redpay_installverify_pairs — CREATE OR REPLACE (#6)
--    live 정의(20260803235500 installverify) verbatim 재현 + foot_raw CTE registry 술어 3곳에
--    AND NOT COALESCE(reconcile_excluded,false) 추가. SELECT 컬럼/순서/조인 전부 불변(회귀 방어).
-- ============================================================
CREATE OR REPLACE VIEW public.v_redpay_installverify_pairs
WITH (security_invoker = true) AS
WITH foot_raw AS (
  -- 풋 스코프 = 대사뷰(v_redpay_reconciliation_daily)와 동일 registry-파생 필터 + tid/merchant COALESCE 폴백.
  --   + 정산 배제축(reconcile_excluded) 균일 적용 = 470 등 배제단말 net0 분류대상 제외.
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
            WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active
              AND NOT COALESCE(redpay_terminal_registry.reconcile_excluded, false)))
    AND (COALESCE(r.tid, (r.raw_payload -> 'data'::text) ->> 'tid'::text) IN (
           SELECT redpay_terminal_registry.tid
             FROM public.redpay_terminal_registry
            WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active
              AND NOT COALESCE(redpay_terminal_registry.reconcile_excluded, false) AND redpay_terminal_registry.tid IS NOT NULL
           UNION
           SELECT unnest(redpay_terminal_registry.superseded_tids)
             FROM public.redpay_terminal_registry
            WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active
              AND NOT COALESCE(redpay_terminal_registry.reconcile_excluded, false) AND redpay_terminal_registry.superseded_tids IS NOT NULL))
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
  'T-20260806-TESTTID-479470: foot_raw registry-스코프에 reconcile_excluded 배제축 추가(정산 배제단말 제외). '
  'is_test/is_simulation(canonical)과 별도 축(semantic firewall). security_invoker=true → 호출자 clinic RLS.';

GRANT SELECT ON public.v_redpay_installverify_pairs TO authenticated;

-- ============================================================
-- 3. VIEW v_redpay_reconciliation_daily — CREATE OR REPLACE (#4)
--    live 정의(20260803235500 installverify) verbatim 재현 + registry 술어 6곳(redpay 앵커 3 +
--    crm 앵커 EXISTS 3)에 AND NOT COALESCE(reconcile_excluded,false) 추가. install_verify 2컬럼·
--    컬럼순서/조인/security_invoker 전부 불변(회귀 방어). CREATE OR REPLACE = 컬럼 말미추가만(무).
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
          WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active
            AND NOT COALESCE(redpay_terminal_registry.reconcile_excluded, false)))
    AND (COALESCE(r.tid, (r.raw_payload -> 'data'::text) ->> 'tid'::text) IN (
           SELECT redpay_terminal_registry.tid
             FROM redpay_terminal_registry
            WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active
              AND NOT COALESCE(redpay_terminal_registry.reconcile_excluded, false) AND redpay_terminal_registry.tid IS NOT NULL
           UNION
           SELECT unnest(redpay_terminal_registry.superseded_tids)
             FROM redpay_terminal_registry
            WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active
              AND NOT COALESCE(redpay_terminal_registry.reconcile_excluded, false) AND redpay_terminal_registry.superseded_tids IS NOT NULL))
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
                  WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active
                    AND NOT COALESCE(redpay_terminal_registry.reconcile_excluded, false)))
            AND (COALESCE(r2.tid, (r2.raw_payload -> 'data'::text) ->> 'tid'::text) IN (
                   SELECT redpay_terminal_registry.tid
                     FROM redpay_terminal_registry
                    WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active
                      AND NOT COALESCE(redpay_terminal_registry.reconcile_excluded, false) AND redpay_terminal_registry.tid IS NOT NULL
                   UNION
                   SELECT unnest(redpay_terminal_registry.superseded_tids)
                     FROM redpay_terminal_registry
                    WHERE redpay_terminal_registry.domain = 'foot'::text AND redpay_terminal_registry.active
                      AND NOT COALESCE(redpay_terminal_registry.reconcile_excluded, false) AND redpay_terminal_registry.superseded_tids IS NOT NULL))
            AND (r2.approved_at AT TIME ZONE 'Asia/Seoul'::text)::date = (p.created_at AT TIME ZONE 'Asia/Seoul'::text)::date));

COMMENT ON VIEW public.v_redpay_reconciliation_daily IS
  'T-20260708-foot-REDPAY-CLOSING-TAB: 일마감 레드페이 하위탭 read-only 대조 뷰. '
  'redpay 승인 1건=1행(풋 merchant_id 1차 권위 + TID 보조, redpay_terminal_registry SSOT 파생) + missing_at_van(당일 raw EXISTS 가드). '
  'T-20260724-...-0723GAP Opt-B′: tid-membership = tid ∪ unnest(superseded_tids) (재프로비저닝 구·신 TID 모두 가시). '
  'T-20260803-INSTALLVERIFY: install_verify_presumed/evidence 2컬럼 ADDITIVE(설치검증 추정 net0 쌍 read-time 파생, v_redpay_installverify_pairs LEFT JOIN). '
  'T-20260806-TESTTID-479470: registry-스코프 술어 6곳에 reconcile_excluded 배제축 추가(정산 배제단말=470 열거/매칭 제외). '
  'security_invoker=true → 호출자 clinic RLS 적용.';

GRANT SELECT ON public.v_redpay_reconciliation_daily TO authenticated;

-- ============================================================
-- 4. SEED — 시험단말 TID 1047479470 단일행 편입 (VG4)
--    active=true(#1 게이트 선택가능 + #2 Plan-B MERNO 결제허용) + reconcile_excluded=true(#3~#7 배제).
--    ★merchant_id = TID self-anchor '1047479470' — 470 의 실 RedPay merchant_id 미제공(reporter=TID만).
--      1047* 는 tid-format → 기존 merchant_id(전부 1777*) 와 UNIQUE 무충돌. #2 MERNO 게이트는
--      (merchant_id=v_merno OR tid=v_merno OR v_merno=ANY superseded) → merchant_id·tid 둘 다 470 로
--      셀프앵커 → merchant 값이 470 로 오면 통과. 470=RedPay-blind(raw 0) → 정산 소비처 무영향(격리).
--    ★clinic_id = business_no 511-60-00988 클리닉(best-effort·원 seed 패턴 계승·RLS 앵커).
--    멱등: ON CONFLICT(merchant_id) DO UPDATE(재실행 시 active/reconcile_excluded 재설정 무해).
-- ============================================================
WITH foot_clinic AS (
  SELECT id AS clinic_id
  FROM public.clinics
  WHERE business_no = '511-60-00988'
  ORDER BY id
  LIMIT 1
)
INSERT INTO public.redpay_terminal_registry
  (clinic_id, domain, merchant_id, tid, terminal_label, active, reconcile_excluded, source, verified_at)
SELECT
  fc.clinic_id,
  'foot',
  '1047479470',        -- merchant_id (TID self-anchor — 실 merchant_id 미제공, 아래 source provenance)
  '1047479470',        -- tid (reporter 제공·#1 게이트 selectability 앵커)
  '풋(시험검증)',
  true,                -- active: #1 게이트 선택 + #2 Plan-B 결제 허용
  true,                -- reconcile_excluded: #3~#7 정산/대사 소비처 전부 배제(방화벽)
  '시험용 검증단말(reconcile_excluded=true). 구 bizno 511-60-00988·RedPay 전기간 조회 0(정산 오염 0). '
    'merchant_id=TID self-anchor(실 RedPay merchant_id 미제공·reporter 최필경 TID만 제공). '
    'T-20260806-foot-TESTTID-479470-PERSEAT-REGISTER-ENABLE / DA-20260806-foot-TESTTID-479470.',
  now()
FROM foot_clinic fc
ON CONFLICT (merchant_id) DO UPDATE SET
  active             = EXCLUDED.active,
  reconcile_excluded = EXCLUDED.reconcile_excluded,
  tid                = EXCLUDED.tid,
  terminal_label     = EXCLUDED.terminal_label,
  source             = EXCLUDED.source,
  verified_at        = EXCLUDED.verified_at,
  updated_at         = now();
