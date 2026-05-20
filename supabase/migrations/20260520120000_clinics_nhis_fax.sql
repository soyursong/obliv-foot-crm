-- T-20260520-foot-PRINT-FORM-BIND: clinics 테이블에 요양기관번호(nhis_code) + 팩스(fax) 추가
-- AC-3 처방전 요양기관번호, AC-5 진단서 전화/팩스 서류 바인딩 지원
-- 안전: NULL 허용 컬럼 추가 → 기존 데이터 무영향
-- 롤백: 20260520120000_clinics_nhis_fax.down.sql

BEGIN;

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS nhis_code TEXT,
  ADD COLUMN IF NOT EXISTS fax       TEXT;

COMMENT ON COLUMN clinics.nhis_code IS '요양기관번호 (건강보험심사평가원 기관코드) — T-20260520-foot-PRINT-FORM-BIND';
COMMENT ON COLUMN clinics.fax       IS '팩스번호 — T-20260520-foot-PRINT-FORM-BIND';

-- 검증
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'clinics' AND column_name = 'nhis_code'
  ) THEN
    RAISE EXCEPTION 'clinics.nhis_code 컬럼 추가 실패';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'clinics' AND column_name = 'fax'
  ) THEN
    RAISE EXCEPTION 'clinics.fax 컬럼 추가 실패';
  END IF;
END $$;

COMMIT;
