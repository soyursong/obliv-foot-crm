-- ══════════════════════════════════════════════════════════════════
-- T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD — OCR 영수증 수납 ↔ 레드페이 자동대조
-- ══════════════════════════════════════════════════════════════════
-- ⚠ PROPOSAL 아티팩트 — data-architect CONSULT(1차 스키마 게이트) GO 전 prod 미적용.
--   dev-foot 자문게이트(§S2.4): 신규 컬럼 ADD 전 DA CONSULT 미선행 시 deploy-ready 금지.
--   본 파일 = CONSULT 첨부 설계 embodiment. supervisor DDL-diff 후에만 apply.
--
-- Rollback: 20260710120000_ocr_receipt_redpay_match.rollback.sql
--
-- ── 설계 요지 ────────────────────────────────────────────────────────
-- Step1(업로드·영구저장): payments.image_url = 영수증 이미지 영구경로(수납 레코드 맵핑).
-- Step2(OCR 추출·검증팝업): 승인번호(8자리)=기존 payments.external_approval_no 재사용(신규 0),
--   결제금액=기존 payments.amount 재사용, 인쇄시각=신규 payments.ocr_receipt_datetime.
--   OCR 원본 추적 = 기존 receipt_ocr_results(+parsed_approval_no 신규 컬럼).
-- Step3(레드페이 자동대조) 매칭전략(LOCKED gate#6):
--   주키 = 승인번호(8자리) + 결제금액.  +보강 = 인쇄시각 ↔ approved_at ±15분 window 병용.
--   +TID = 있으면 보조, 없으면 무시(강제 아님).
-- Step4([영수증 수납] 탭): read-only VIEW v_receipt_settlement_daily (FE 조인/매칭 재계산 금지).
--
-- ── SSOT 주의 (컬럼① 표시축) ─────────────────────────────────────────
-- 화면 표시·매칭 = ocr_receipt_datetime(실물 영수증 인쇄시각). created_at(시스템 업로드시각)과 별개 축.
-- (MSG-95y7 later-wins SSOT. MSG-0dyw '촬영·업로드 일시'는 표시축 아님.)
--
-- ── PCI 마스킹 가드 ──────────────────────────────────────────────────
-- 카드 전체 PAN(16자리) 영속 금지. 승인번호(≤12자리)·금액·인쇄시각만 저장.
-- receipt_ocr_results.raw_text 는 EF 단계에서 PAN 마스킹 후 적재(EF 가드 SSOT).
-- 아래 CHECK 는 DB-레벨 2차 방어(연속 13자리 이상 숫자열 = PAN 의심 → 저장 거부).
-- (DA 판정 대상: DB CHECK 채택 여부 / EF-only 여부.)
--
-- risk: ADDITIVE-ONLY (신규 nullable 컬럼 3 + read-only VIEW 1). 파괴적 변경 0.
-- ══════════════════════════════════════════════════════════════════

-- ── 풋 단말기 13 TID 화이트리스트 (공유 merchant 511-60-00988 내 풋 판별자) ──
--   v_redpay_reconciliation_daily 와 동일 집합. +TID 보조 매칭·서버권위 필터용.

-- ============================================================
-- 1. payments — 영수증 영구경로 + 인쇄시각 (ADDITIVE, nullable)
-- ============================================================
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS image_url            TEXT,         -- Step1: 영수증 이미지 영구 URL(receipts 버킷)
  ADD COLUMN IF NOT EXISTS ocr_receipt_datetime TIMESTAMPTZ;  -- Step2: 영수증 인쇄시각(표시·매칭 SSOT)

COMMENT ON COLUMN public.payments.image_url IS
  'T-20260710-OCR-RECEIPT: 영수증 이미지 영구경로(receipts 버킷). NULL=OCR 영수증 비첨부 수납.';
COMMENT ON COLUMN public.payments.ocr_receipt_datetime IS
  'T-20260710-OCR-RECEIPT: 실물 영수증 인쇄 결제일시(OCR값). [영수증 수납] 컬럼① 표시축 + 레드페이 ±15분 매칭축. created_at(업로드시각)과 별개.';

-- ============================================================
-- 2. receipt_ocr_results — 승인번호(8자리) OCR 파싱 결과 추적 (ADDITIVE)
-- ============================================================
ALTER TABLE public.receipt_ocr_results
  ADD COLUMN IF NOT EXISTS parsed_approval_no TEXT;  -- OCR 추출 승인번호(8자리) — 검증팝업 프리필/오인식 이력 추적

COMMENT ON COLUMN public.receipt_ocr_results.parsed_approval_no IS
  'T-20260710-OCR-RECEIPT: OCR 추출 승인번호(8자리). 검증팝업 프리필 소스. 확정값은 payments.external_approval_no 로 승격.';

-- ── PCI 2차 방어 (DA 판정 대상) — raw_text 연속 13자리+ 숫자열(PAN 의심) 저장 거부 ──
--   승인번호(≤12) 통과, 전체 PAN(13~16) 차단. 하이픈/공백 제거 후 검사는 EF 가드가 담당.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receipt_ocr_results_no_full_pan'
  ) THEN
    ALTER TABLE public.receipt_ocr_results
      ADD CONSTRAINT receipt_ocr_results_no_full_pan
      CHECK (raw_text !~ '[0-9]{13,}');
  END IF;
END
$$;

-- ============================================================
-- 3. VIEW v_receipt_settlement_daily — [영수증 수납] 탭 read-only 대조 뷰
--    grain = OCR 영수증 첨부 수납 1건 = 1행 (payment-anchored).
--    매칭전략(LOCKED): 주키 승인번호+금액, +보강 인쇄시각↔approved_at ±15분 window 병용.
--    FE 는 이 뷰만 소비 — FE 조인/매칭 재계산 금지(매처 진실원천 이중화 방지).
--    security_invoker=true → 호출자 clinic RLS 적용.
-- ============================================================
CREATE OR REPLACE VIEW public.v_receipt_settlement_daily
WITH (security_invoker = true) AS
SELECT
  p.id                                                        AS payment_id,
  p.clinic_id                                                 AS clinic_id,
  -- close_date = 인쇄시각 우선(SSOT), 없으면 업로드시각 폴백
  COALESCE(
    (p.ocr_receipt_datetime AT TIME ZONE 'Asia/Seoul')::date,
    (p.created_at           AT TIME ZONE 'Asia/Seoul')::date
  )                                                           AS close_date,
  p.ocr_receipt_datetime                                      AS receipt_datetime,   -- 컬럼① 표시(인쇄시각 SSOT)
  p.created_at                                                AS uploaded_at,        -- 시스템 업로드시각(별개 축)
  c.name                                                      AS customer_name,      -- 컬럼②
  c.chart_number                                              AS chart_number,       -- 컬럼②(차트번호)
  p.amount::numeric                                           AS ocr_amount,         -- 컬럼③ 결제금액(OCR확정)
  p.external_approval_no                                      AS approval_no,        -- 컬럼④ 승인번호=매칭핵심키
  p.external_tid                                              AS tid,                -- +TID 보조(있으면)
  p.image_url                                                 AS image_url,          -- 컬럼⑤ 원본 영수증
  -- ── 레드페이 자동대조 (주키 승인번호+금액 AND ±15분 window 병용) ──
  rp.id                                                       AS redpay_row_id,
  rp.approved_at                                              AS redpay_approved_at,
  rp.amount::numeric                                          AS redpay_amount,
  rp.tid                                                      AS redpay_tid,
  CASE
    WHEN p.external_approval_no IS NULL THEN 'no_approval'    -- 승인번호 미확정(OCR 실패/미입력)
    WHEN rp.id IS NOT NULL              THEN 'matched'
    ELSE 'unmatched'
  END                                                         AS match_status
FROM public.payments p
JOIN public.customers c ON c.id = p.customer_id
LEFT JOIN LATERAL (
  SELECT r.id, r.approved_at, r.amount, r.tid
  FROM public.redpay_raw_transactions r
  WHERE r.clinic_id = p.clinic_id
    AND p.external_approval_no IS NOT NULL
    AND r.approval_no = p.external_approval_no                -- 주키①: 승인번호(8자리)
    AND r.amount      = p.amount                              -- 주키②: 결제금액
    AND (
      p.ocr_receipt_datetime IS NULL                         -- 인쇄시각 없으면 주키만
      OR abs(extract(epoch FROM (r.approved_at - p.ocr_receipt_datetime))) <= 900  -- +보강 ±15분(900초)
    )
    AND r.tid IN (
      '1047479483','1047479476','1047479477','1047479478','1047479479',
      '1047479480','1047479481','1047479482','1047479153','1047479148',
      '1047479155','1047479158','1047479157'
    )
  -- 동일금액 반복결제 코너: 인쇄시각에 가장 가까운 레드페이 1건 선택
  ORDER BY abs(extract(epoch FROM (r.approved_at - COALESCE(p.ocr_receipt_datetime, p.created_at)))) ASC
  LIMIT 1
) rp ON true
WHERE p.image_url IS NOT NULL                                -- OCR 영수증 업로드 건만
  AND p.payment_type = 'payment'
  AND COALESCE(p.status, '') <> 'deleted';

COMMENT ON VIEW public.v_receipt_settlement_daily IS
  'T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD: [영수증 수납] 탭 read-only 대조 뷰. '
  'grain=OCR 영수증 첨부 수납 1건=1행. 5컬럼(인쇄시각/성함·차트/OCR금액/승인번호/이미지) + 레드페이 매칭. '
  '매칭전략(LOCKED): 주키=승인번호(8자리)+금액, +보강=인쇄시각↔approved_at ±15분 window 병용, 풋 13 TID 서버권위. '
  'match_status ∈ matched/unmatched/no_approval. FE 는 이 뷰만 소비(조인/매칭 재계산 금지). security_invoker=true.';

GRANT SELECT ON public.v_receipt_settlement_daily TO authenticated;
