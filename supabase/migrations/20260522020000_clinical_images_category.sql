-- T-20260522-foot-PHOTO-CAPTURE: clinical_images 테이블 + category 컬럼 추가
--
-- AC-4: clinical_images.category 컬럼 확인 → 없으면 추가 (nullable, before/after)
--
-- 설계 메모:
--   clinical_images: 진료이미지 메타데이터 DB 추적 테이블
--   Storage 경로는 customer/{customer_id}/treatment-images/{type}_{ts}_{rand}.jpg 규칙 유지
--   category: 'before' | 'after' | 'photo' (nullable — 구버전 Storage 파일 명세 호환)
--   check_in_id: nullable — 패키지 회차 외 독립 촬영도 허용
--
-- 적용 순서:
--   [1] clinical_images 테이블 CREATE IF NOT EXISTS (신규 환경)
--   [2] ALTER TABLE ... ADD COLUMN IF NOT EXISTS category (기존 테이블 패치)
--   [3] RLS 활성화 + auth_all 정책 (기존 패턴 일치)
--
-- Rollback: 20260522020000_clinical_images_category.down.sql
-- Ticket:   T-20260522-foot-PHOTO-CAPTURE
-- Applied:  2026-05-22

-- [1] 테이블 생성 (없을 경우)
CREATE TABLE IF NOT EXISTS clinical_images (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id    UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  customer_id  UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  check_in_id  UUID        REFERENCES check_ins(id) ON DELETE SET NULL,
  storage_path TEXT        NOT NULL,
  -- category: 시술 전(before) / 시술 후(after) / 기타(photo)
  -- nullable — 구버전 Storage 경로만 있는 레코드는 NULL 허용
  category     TEXT        CHECK (category IN ('before', 'after', 'photo')),
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- [2] category 컬럼 보장 — 테이블이 이미 존재했으나 category 없던 경우 패치
ALTER TABLE clinical_images
  ADD COLUMN IF NOT EXISTS category TEXT CHECK (category IN ('before', 'after', 'photo'));

-- [3] RLS 활성화
ALTER TABLE clinical_images ENABLE ROW LEVEL SECURITY;

-- auth_all: 인증된 사용자 전체 CRUD (기존 obliv-foot-crm RLS 패턴 동일)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clinical_images' AND policyname = 'auth_all'
  ) THEN
    EXECUTE 'CREATE POLICY "auth_all" ON clinical_images FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END
$$;

-- [4] 인덱스: customer + created_at 정렬 쿼리 최적화
CREATE INDEX IF NOT EXISTS clinical_images_customer_id_created_at_idx
  ON clinical_images (customer_id, created_at DESC);
