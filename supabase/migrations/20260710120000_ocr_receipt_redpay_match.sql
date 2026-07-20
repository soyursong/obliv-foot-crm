-- ══════════════════════════════════════════════════════════════════
-- T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD — OCR 영수증 수납 ↔ 레드페이 자동대조
-- ══════════════════════════════════════════════════════════════════
-- ⚠ ADDITIVE 마이그. data-architect CONSULT(1차 스키마 게이트) GO 수신 완료
--   (MSG-20260710-151152-qd7x: 컬럼 3종 GO(ADDITIVE) · 뷰 REVISE 반영본 · PCI CHECK ADOPT).
--   apply 게이트 = supervisor DDL-diff (ADDITIVE+DA GO → 대표게이트 면제, autonomy §3.1).
--
-- Rollback: 20260710120000_ocr_receipt_redpay_match.rollback.sql
--
-- ── DA 검증 확정(information_schema, 2026-07-10) ──────────────────────
-- Model A 4아티팩트 foot prod 실재 확인 ✅:
--   redpay_raw_transactions · payment_reconciliation_log · redpay_poller_state · payments(recon 컬럼).
-- 재사용 컬럼 실제명(foot는 external_* 접두, canonical 표기와 drift) ✅:
--   payments.external_approval_no / external_tid / external_trxid / external_status
--   / external_root_trxid / reconciled_at / amount  (신규 approval/tid 컬럼 신설 금지 — 재사용).
-- PCI 위반행 count(raw_text ~ '[0-9]{13,}') = 0 실측 ✅ → NOT VALID→VALIDATE 안전.
--
-- ── 설계 요지 ────────────────────────────────────────────────────────
-- Step1(업로드·영구저장): payments.image_url = 영수증 이미지 영구경로(수납 레코드 맵핑).
-- Step2(OCR 추출·검증팝업):
--   승인번호(8자리) 확정값 = 기존 payments.external_approval_no 재사용(신규 0),
--   결제금액 확정값     = 기존 payments.amount 재사용(신규 0, ocr_amount 신설 금지 — DA[3]),
--   인쇄시각            = 신규 payments.ocr_receipt_datetime,
--   OCR 원문 추적       = receipt_ocr_results.parsed_approval_no(신규) + parsed_amount(기존 재사용, provenance).
-- Step3(레드페이 자동대조): ★뷰가 매칭을 재계산하지 않는다.
--   매칭 SSOT = redpay-reconcile EF(4-Tier: approval_no+amount+approved_at±5min+tid).
--   매처가 payments.reconciled_at / redpay_raw_transactions.matched_payment_id /
--   payment_reconciliation_log 에 영속화한 결과를 뷰가 JOIN 하여 surface only.
-- Step4([영수증 수납] 탭): read-only VIEW v_receipt_settlement_daily (매처 산출 표면화).
--
-- ── SSOT 주의 (컬럼① 표시축) ─────────────────────────────────────────
-- 화면 표시 = ocr_receipt_datetime(실물 영수증 인쇄시각). created_at(시스템 업로드시각)과 별개 축.
-- (MSG-95y7 later-wins SSOT. MSG-0dyw '촬영·업로드 일시'는 표시축 아님.)
-- ★매칭축(±윈도)은 뷰가 아니라 매처(EF) 소관 — 인쇄시각을 매처 CRM측 시각앵커로 접수하는 건
--   별도 EF 개선 티켓(DA[1]). 본 뷰엔 시각윈도 재계산 없음.
--
-- ── write-precedence / 멱등 가드 (DA[2] 가드①②) ─────────────────────
-- 가드①(later-wins): OCR 확정 승인번호 승격은 external_approval_no 가 NULL 일 때만 write,
--   또는 스태프 명시 확정+overwrite 이력을 receipt_ocr_results 에 기록(비-OCR 소스 조용한 덮어쓰기 금지).
--   → FE/EF write 경로에서 강제(FE DB-바인딩 단계). 아래 부분 UNIQUE 인덱스는 멱등(가드②) DB 2차방어.
-- 가드②(idempotent): 동일 영수증 재촬영/재처리 시 payments 중복 INSERT 방지
--   → 부분 UNIQUE 인덱스(image_url IS NOT NULL 인 OCR 영수증 건에 한정, 아래 §4).
--
-- ── PCI 마스킹 가드 (DA[5] ADOPT · defense-in-depth) ─────────────────
-- PRIMARY = EF 단계 PAN 마스킹(마스킹 SSOT). DB CHECK = 연속 미마스킹 PAN 2차방어(both, either/or 아님).
-- backstop-only: '[0-9]{13,}' 는 연속 13~16자리만 차단(공백/대시 분절 PAN 은 통과 → EF가 잡음).
-- 통과: 사업자번호(10)·전화(11)·승인번호(≤12). 차단: 연속 13자리+(전체 PAN, 연속13 RRN).
-- NOT VALID→VALIDATE 패턴(count=0 실측 확인 후·무중단·기존행 톨러런스).
--
-- risk: ADDITIVE-ONLY (신규 nullable 컬럼 3 = payments.image_url/ocr_receipt_datetime
--       + receipt_ocr_results.parsed_approval_no. parsed_amount 는 기존 컬럼 재사용(신규 아님).
--       + 부분 UNIQUE 인덱스 1 + CHECK 1 + read-only VIEW 1). 파괴적 변경 0.
-- ══════════════════════════════════════════════════════════════════

-- 풋 스코프 화이트리스트 (redpay_foot_terminal_registry.md §2 = authoritative).
--   [2026-07-11 피벗 REDPAY-MACSTUDIO-POLLER + DA GO] 1차 권위 = merchant_id 17(raw_payload->merchant->>id).
--   보조 = TID 17(belt-and-suspenders). §787/§519 소비뷰 스코프 불변식 — business_no 단독 불충분.
--   도수/피부/롱레는 merchant 대역 밖 → 구조적 자동배제. v_redpay_reconciliation_daily 와 동일 집합.

-- ============================================================
-- 1. payments — 영수증 영구경로 + 인쇄시각 (ADDITIVE, nullable) — DA[1] GO
-- ============================================================
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS image_url            TEXT,         -- Step1: 영수증 이미지 영구 URL(receipts 버킷)
  ADD COLUMN IF NOT EXISTS ocr_receipt_datetime TIMESTAMPTZ;  -- Step2: 영수증 인쇄시각(표시 SSOT)

COMMENT ON COLUMN public.payments.image_url IS
  'T-20260710-OCR-RECEIPT: 영수증 이미지 영구경로(receipts 버킷). NULL=OCR 영수증 비첨부 수납.';
COMMENT ON COLUMN public.payments.ocr_receipt_datetime IS
  'T-20260710-OCR-RECEIPT: 실물 영수증 인쇄 결제일시(OCR값). [영수증 수납] 컬럼① 표시축. created_at(업로드시각)과 별개. 매칭축 아님(매칭=redpay-reconcile EF).';

-- ============================================================
-- 2. receipt_ocr_results — OCR 원문 추출값 provenance (ADDITIVE) — DA[1][3] GO
--    확정값은 payments(external_approval_no·amount)로 승격, 원문은 여기 보관(OCR 정확도 텔레메트리).
-- ============================================================
-- ── parsed_amount 는 신규 아님 = 기존 컬럼 재사용 (DDL-diff destructive mismatch 방지) ──
--   20260522030000_receipt_ocr_results.sql L21 에서 parsed_amount INTEGER 이미 신설(prod 기실재).
--   본 마이그가 신규로 추가하는 컬럼은 parsed_approval_no 하나뿐. parsed_amount 는 OCR provenance
--   용도로 기존 컬럼을 그대로 재사용한다(신규 ADD 금지 → no-op 이지만 DDL-diff 오인 회피).
--   → rollback 에서도 parsed_amount 는 DROP 하지 않는다(기존 OCR 결과 데이터 무손실).
ALTER TABLE public.receipt_ocr_results
  ADD COLUMN IF NOT EXISTS parsed_approval_no TEXT;     -- OCR 추출 승인번호(8자리) — 검증팝업 프리필/오인식 이력

COMMENT ON COLUMN public.receipt_ocr_results.parsed_approval_no IS
  'T-20260710-OCR-RECEIPT: OCR 추출 승인번호(8자리). 검증팝업 프리필 소스. 확정값은 payments.external_approval_no 로 승격(later-wins: NULL일 때만 조용히 write).';
-- (기존 컬럼 재사용 — 20260522030000 L21 신설. 본 마이그는 comment 재정의만, 컬럼 신규 아님.)
COMMENT ON COLUMN public.receipt_ocr_results.parsed_amount IS
  'T-20260710-OCR-RECEIPT(기존 컬럼 재사용): OCR 추출 결제금액(원단위). provenance/오인식 감사·OCR 정확도 텔레메트리용. 확정 진실원천은 payments.amount(이중컬럼 divergence 방지).';

-- ── PCI 2차 방어 (DA[5] ADOPT) — raw_text 연속 13자리+ 숫자열(전체 PAN 의심) 저장 거부 ──
--   count=0 실측 확인(2026-07-10) 후 NOT VALID→VALIDATE(무중단·기존행 톨러런스).
--   EF-단계 마스킹이 PRIMARY, 본 CHECK 는 연속 미마스킹 PAN 2차방어(both).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receipt_ocr_results_no_full_pan'
  ) THEN
    ALTER TABLE public.receipt_ocr_results
      ADD CONSTRAINT receipt_ocr_results_no_full_pan
      CHECK (raw_text !~ '[0-9]{13,}') NOT VALID;   -- 기존행 스킵, 신규/변경행만 강제
    ALTER TABLE public.receipt_ocr_results
      VALIDATE CONSTRAINT receipt_ocr_results_no_full_pan;  -- count=0 확인됨 → 즉시 검증
  END IF;
END
$$;

-- ============================================================
-- 3. VIEW v_receipt_settlement_daily — [영수증 수납] 탭 read-only 대조 뷰 (DA[4] REVISE 반영)
--    grain = OCR 영수증 첨부 수납 1건 = 1행 (payment-anchored).
--    ★매칭 재계산 없음 — 매처(redpay-reconcile EF)가 영속화한 결과만 JOIN surface.
--      · redpay_raw_transactions.matched_payment_id = p.id  (매처 링크, approval+amount+윈도 재계산 아님)
--      · payments.reconciled_at                              (매처 대사시각)
--      · payment_reconciliation_log                          (대사 verdict/enum)
--    §787/§519 스코프 불변식: rp 조인·freshness 에 풋 merchant_id 26(1차)+TID 17(보조) 필터.
--    §789 freshness: 피드 마지막 approved_at 노출 → 未적재를 missing 오탐 금지.
--    security_invoker=true → 호출자 clinic RLS 적용.
-- ============================================================
CREATE OR REPLACE VIEW public.v_receipt_settlement_daily
WITH (security_invoker = true) AS
SELECT
  p.id                                                        AS payment_id,
  p.clinic_id                                                 AS clinic_id,
  -- close_date = 인쇄시각 우선(표시 SSOT), 없으면 업로드시각 폴백
  COALESCE(
    (p.ocr_receipt_datetime AT TIME ZONE 'Asia/Seoul')::date,
    (p.created_at           AT TIME ZONE 'Asia/Seoul')::date
  )                                                           AS close_date,
  p.ocr_receipt_datetime                                      AS receipt_datetime,   -- 컬럼① 표시(인쇄시각)
  p.created_at                                                AS uploaded_at,        -- 시스템 업로드시각(별개)
  c.name                                                      AS customer_name,      -- 컬럼②
  c.chart_number                                              AS chart_number,       -- 컬럼②(차트번호)
  p.amount::numeric                                           AS amount,             -- 컬럼③ 결제금액(확정 SSOT)
  p.external_approval_no                                      AS approval_no,        -- 컬럼④ 승인번호(확정값 surface)
  p.external_tid                                              AS tid,                -- 참고(매처 tid)
  p.image_url                                                 AS image_url,          -- 컬럼⑤ 원본 영수증
  p.reconciled_at                                             AS reconciled_at,      -- 매처 대사시각
  -- ── 매처가 링크한 VAN 승인행 (matched_payment_id JOIN — 재계산 아님) ──
  rp.id                                                       AS redpay_row_id,
  rp.approved_at                                              AS redpay_approved_at,
  rp.amount::numeric                                          AS redpay_amount,
  rp.tid                                                      AS redpay_tid,
  rp.match_rule                                               AS match_rule,         -- 매처 Tier
  -- ── 대사 verdict (recon_log enum, 최신 1건 surface) ──
  rl.event_type                                               AS recon_event_type,
  rl.mismatch_reason                                          AS recon_mismatch_reason,
  -- ── match_status = 매처 산출 기반 (뷰 판정 아님) ──
  CASE
    WHEN rp.id IS NOT NULL OR p.reconciled_at IS NOT NULL THEN 'matched'
    ELSE 'unmatched'
  END                                                         AS match_status,
  -- ── freshness (§789): 피드 watermark → 未적재 missing 오탐 방지 ──
  (SELECT max(r2.approved_at)
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
       AND r2.tid IN (                                 -- belt-and-suspenders: 풋 TID 26
         '1047479255','1047479254','1047479261','1047479268','1047479262',
         '1047479263','1047479264','1047479469','1047479471','1047479472',
         '1047479473','1047479474','1047479475','1047479483','1047479476',
         '1047479477','1047479478','1047479479','1047479480','1047479481',
         '1047479482','1047479153','1047479148','1047479155','1047479158',
         '1047479157'
       ))                                                     AS redpay_feed_last_approved_at
FROM public.payments p
JOIN public.customers c ON c.id = p.customer_id
-- 매처 링크(matched_payment_id) 로만 조인 — 승인번호/금액/윈도 재계산 제거 (DA[4])
LEFT JOIN public.redpay_raw_transactions rp
       ON rp.matched_payment_id = p.id
      AND (rp.raw_payload->'merchant'->>'id') IN (            -- 1차 권위: 풋 merchant_id 26(§787/§519)
        '1777285001','1777285003','1777285004','1777285005','1777285006',
        '1777285007','1777285008','1777288001','1777288003','1777288004',
        '1777288005','1777288006','1777288008','1777289001','1777289002',
        '1777289003','1777289004','1777289005','1777289006','1777289007',
        '1777289008','1777289009','1777289010','1777289011','1777289012',
        '1777289013'
      )
      AND rp.tid IN (                                         -- belt-and-suspenders: 풋 TID 26
        '1047479255','1047479254','1047479261','1047479268','1047479262',
        '1047479263','1047479264','1047479469','1047479471','1047479472',
        '1047479473','1047479474','1047479475','1047479483','1047479476',
        '1047479477','1047479478','1047479479','1047479480','1047479481',
        '1047479482','1047479153','1047479148','1047479155','1047479158',
        '1047479157'
      )
-- 대사 verdict 최신 1건 surface (매칭 계산 아님 — 최신 로그행 픽업)
LEFT JOIN LATERAL (
  SELECT rl2.event_type, rl2.mismatch_reason
  FROM public.payment_reconciliation_log rl2
  WHERE rl2.payment_id = p.id
  ORDER BY rl2.created_at DESC
  LIMIT 1
) rl ON true
WHERE p.image_url IS NOT NULL                                -- OCR 영수증 업로드 건만
  AND p.payment_type = 'payment'
  AND COALESCE(p.status, '') <> 'deleted';

COMMENT ON VIEW public.v_receipt_settlement_daily IS
  'T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD: [영수증 수납] 탭 read-only 대조 뷰. '
  'grain=OCR 영수증 첨부 수납 1건=1행. 5컬럼(인쇄시각/성함·차트/금액/승인번호/이미지). '
  '★매칭 재계산 없음 — 매처(redpay-reconcile EF)가 영속화한 matched_payment_id/reconciled_at/recon_log 를 surface only. '
  '§787/§519 풋 merchant_id 26(1차)+TID 17(보조) 서버권위 필터. §789 freshness(redpay_feed_last_approved_at) 노출. '
  'match_status ∈ matched/unmatched. FE 는 이 뷰만 소비(조인/매칭 재계산 금지). security_invoker=true.';

GRANT SELECT ON public.v_receipt_settlement_daily TO authenticated;

-- ============================================================
-- 4. 멱등 가드 (DA[2] 가드②) — 동일 영수증 재촬영 payments 중복 INSERT 2차방어
--    부분 UNIQUE: OCR 영수증 건(image_url IS NOT NULL) 한정, 승인번호+금액+인쇄시각 조합 유일.
--    image_url 신규 컬럼(현재 전량 NULL) → 기존행 0 매칭 → 무충돌 생성.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS payments_ocr_receipt_idempotent_idx
  ON public.payments (clinic_id, external_approval_no, amount, ocr_receipt_datetime)
  WHERE image_url IS NOT NULL
    AND external_approval_no IS NOT NULL
    AND ocr_receipt_datetime IS NOT NULL;

COMMENT ON INDEX public.payments_ocr_receipt_idempotent_idx IS
  'T-20260710-OCR-RECEIPT: OCR 영수증 수납 멱등 가드(DA 가드②). 동일 승인번호+금액+인쇄시각 재촬영 중복 INSERT 차단. FE 멱등키 DB 2차방어.';
