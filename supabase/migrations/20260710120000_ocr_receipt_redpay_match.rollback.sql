-- Rollback: T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD
-- 20260710120000_ocr_receipt_redpay_match.sql 역적용 (ADDITIVE 되돌리기).
-- 순서: VIEW → 멱등 인덱스 → CHECK → parsed_approval_no → payments 컬럼.
-- nullable 컬럼/인덱스 DROP → 데이터 손실 = OCR 첨부 이력만(수납 금액/승인번호 원장 무손실).
-- ⚠ parsed_amount 는 본 마이그가 신설한 컬럼이 아니라 기존 컬럼 재사용(20260522030000 L21)
--   → 절대 DROP 하지 않는다(기존 OCR 결과 데이터 파괴 방지 · DDL-diff destructive mismatch NO-GO 대응).

DROP VIEW IF EXISTS public.v_receipt_settlement_daily;

DROP INDEX IF EXISTS public.payments_ocr_receipt_idempotent_idx;

ALTER TABLE public.receipt_ocr_results
  DROP CONSTRAINT IF EXISTS receipt_ocr_results_no_full_pan;

-- parsed_amount 는 DROP 제외(기존 컬럼 재사용 — 위 주석 참조). 본 마이그 신설분 parsed_approval_no 만 제거.
ALTER TABLE public.receipt_ocr_results
  DROP COLUMN IF EXISTS parsed_approval_no;

ALTER TABLE public.payments
  DROP COLUMN IF EXISTS ocr_receipt_datetime,
  DROP COLUMN IF EXISTS image_url;
