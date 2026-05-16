-- ============================================================
-- T-20260516-foot-CLINIC-DOC-INFO: 병원·원장 정보 + 서류 field_map 바인딩
-- ============================================================
-- AC-1: clinics 테이블 컬럼 추가 (business_no, established_date)
--       clinic_doctors 테이블 신설 (다중 의사 등록)
-- 안전: NULL 허용 컬럼 추가 + 신규 테이블 생성 → 기존 데이터 무영향
-- 롤백: 20260516000020_clinic_doctor_info.down.sql
-- ============================================================

BEGIN;

-- ── A. clinics 테이블 컬럼 추가 ──
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS business_no TEXT,
  ADD COLUMN IF NOT EXISTS established_date DATE;

-- ── B. clinic_doctors 테이블 신설 ──
CREATE TABLE IF NOT EXISTS clinic_doctors (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id        UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  license_no       TEXT,
  specialist_no    TEXT,
  seal_image_url   TEXT,   -- Supabase storage path: documents/seals/{clinic_id}/{id}
  is_default       BOOLEAN NOT NULL DEFAULT false,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clinic_doctors_clinic_id ON clinic_doctors(clinic_id);
CREATE INDEX IF NOT EXISTS idx_clinic_doctors_active    ON clinic_doctors(clinic_id, active);

-- ── C. RLS ──
ALTER TABLE clinic_doctors ENABLE ROW LEVEL SECURITY;

-- SELECT: 승인된 같은 클리닉 사용자
DROP POLICY IF EXISTS "clinic_doctors_select" ON clinic_doctors;
CREATE POLICY "clinic_doctors_select" ON clinic_doctors
  FOR SELECT TO authenticated
  USING (
    is_approved_user()
    AND clinic_id = current_user_clinic_id()
  );

-- INSERT/UPDATE/DELETE: admin 또는 manager
DROP POLICY IF EXISTS "clinic_doctors_write" ON clinic_doctors;
CREATE POLICY "clinic_doctors_write" ON clinic_doctors
  FOR ALL TO authenticated
  USING (
    is_admin_or_manager()
    AND clinic_id = current_user_clinic_id()
  )
  WITH CHECK (
    is_admin_or_manager()
    AND clinic_id = current_user_clinic_id()
  );

COMMIT;
