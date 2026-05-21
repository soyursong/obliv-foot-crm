-- Rollback: T-20260522-foot-PHOTO-CAPTURE (clinical_images_category)
--
-- 주의:
--   clinical_images 테이블 자체를 DROP 하면 기존 이미지 메타데이터가 전부 삭제됨.
--   운영 환경에서는 DROP TABLE 대신 category 컬럼 제거 + 테이블 보존을 권장.
--
-- [A] 테이블이 이번 마이그레이션으로 신규 생성된 경우: DROP TABLE
-- [B] 테이블이 이미 존재했고 category 컬럼만 추가된 경우: DROP COLUMN 만

-- Rollback B (권장, 기존 레코드 보존)
ALTER TABLE clinical_images
  DROP COLUMN IF EXISTS category;

-- Rollback A (신규 생성이었던 경우만 실행 — 데이터 손실 주의)
-- DROP TABLE IF EXISTS clinical_images;
