-- T-20260622-foot-BLOODTEST-RESULT-PUBLISH-BACKEND (B안 파일보관)
-- 혈액검사 결과지 등 환자 파일 보관 메타 테이블. derm patient_file_records 미러링.
-- 파일 실체는 기존 'documents' 버킷(customer/{customerId}/blood_result_{ts}.{ext})에 보관(신규버킷 X).
--   본 테이블은 메타(파일경로·종류·업로더)만 적재 → 목록/열람 게이트 제공.
-- DA CONSULT-REPLY GO (MSG-20260623-083432-0ov6, ADDITIVE·파괴0·계약충돌0).
-- RLS: clinic_id 스코프 필수(cross-CRM 데이터 계약 §1). foot 표준 current_user_clinic_id() 재사용.
-- 롤백: 20260623150000_patient_file_records.rollback.sql

CREATE TABLE IF NOT EXISTS patient_file_records (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid        NOT NULL REFERENCES clinics(id),
  customer_id uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  file_name   text        NOT NULL,
  file_path   text        NOT NULL,           -- 'documents' 버킷 내부 경로 (customer/{id}/blood_result_{ts}.{ext})
  file_size   bigint,
  mime_type   text        CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  kind        text        NOT NULL DEFAULT 'blood_result',
  uploaded_by uuid        REFERENCES auth.users(id),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pfr_customer ON patient_file_records(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pfr_clinic   ON patient_file_records(clinic_id);

ALTER TABLE patient_file_records ENABLE ROW LEVEL SECURITY;

-- 계약 §1: clinic_id 스코프 — 본인 클리닉 행만 read/insert. (foot 표준 staff membership helper)
CREATE POLICY "clinic_isolation_pfr_select" ON patient_file_records
  FOR SELECT TO authenticated
  USING (clinic_id = current_user_clinic_id());

CREATE POLICY "clinic_isolation_pfr_insert" ON patient_file_records
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id = current_user_clinic_id());

-- 오업로드 정정용 — 업로더 본인 행만 삭제(메타만; storage object는 별도). 클리닉 스코프 동반.
CREATE POLICY "own_delete_pfr" ON patient_file_records
  FOR DELETE TO authenticated
  USING (clinic_id = current_user_clinic_id() AND uploaded_by = auth.uid());

COMMENT ON TABLE patient_file_records IS
  '환자 파일 보관 메타 (T-20260622-foot-BLOODTEST-RESULT-PUBLISH-BACKEND, B안). kind=blood_result 등. 파일 실체=documents 버킷. derm patient_file_records 미러링.';
