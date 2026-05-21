-- T-20260522-foot-RECEIPT-OCR-AUTO: OCR 인식 결과 저장 테이블
--
-- Phase 2a:
--   - OCR 시도마다 결과(성공/실패) 저장
--   - 원본 텍스트 + 파싱 결과 + 신뢰도 추적
--   - provider 컬럼으로 Phase 2b 서비스 교체 이력 관리
--
-- Rollback: 20260522030000_receipt_ocr_results.down.sql
-- Ticket:   T-20260522-foot-RECEIPT-OCR-AUTO
-- Applied:  2026-05-22

CREATE TABLE IF NOT EXISTS receipt_ocr_results (
  id                  UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id           UUID          REFERENCES clinics(id) ON DELETE CASCADE,
  check_in_id         UUID          REFERENCES check_ins(id) ON DELETE SET NULL,
  -- 영수증 이미지 Storage 경로 (receipts 버킷)
  storage_path        TEXT,
  -- OCR 인식 원본 텍스트
  raw_text            TEXT          NOT NULL DEFAULT '',
  -- 파싱된 구조화 데이터
  parsed_amount       INTEGER,
  parsed_method       TEXT          CHECK (parsed_method IN ('card', 'cash', 'transfer')),
  parsed_paid_at      TIMESTAMPTZ,
  parsed_card_company TEXT,
  -- 신뢰도: 0.000 ~ 1.000 (0이면 인식 실패 / 수동입력 폴백)
  confidence          NUMERIC(4,3)  NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  -- OCR 프로바이더 식별자 ('tesseract_stub' | 'google_vision' | 'aws_rekognition' | 'clova')
  provider            TEXT          NOT NULL DEFAULT 'tesseract_stub',
  created_by          UUID          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ   DEFAULT NOW() NOT NULL
);

-- RLS
ALTER TABLE receipt_ocr_results ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'receipt_ocr_results' AND policyname = 'auth_all'
  ) THEN
    EXECUTE 'CREATE POLICY "auth_all" ON receipt_ocr_results FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END
$$;

-- 인덱스: clinic_id + 최신순
CREATE INDEX IF NOT EXISTS receipt_ocr_results_clinic_id_created_at_idx
  ON receipt_ocr_results (clinic_id, created_at DESC);

-- 인덱스: check_in_id 조인
CREATE INDEX IF NOT EXISTS receipt_ocr_results_check_in_id_idx
  ON receipt_ocr_results (check_in_id)
  WHERE check_in_id IS NOT NULL;
