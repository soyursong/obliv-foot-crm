-- T-20260520-foot-MEMO-HISTORY
-- 치료메모 히스토리 누적 저장 테이블 생성
-- GO_WARN: 신규 테이블. 기존 treatment_note 데이터 마이그레이션은 FE lazy migration으로 처리.
-- 롤백: 20260520000100_customer_treatment_memos.down.sql

CREATE TABLE IF NOT EXISTS customer_treatment_memos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  clinic_id       uuid        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  content         text        NOT NULL,
  created_by      text,        -- 작성자 email (auth.jwt()->>'email')
  created_by_name text,        -- 표시 이름
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ctm_customer_id ON customer_treatment_memos(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ctm_clinic_id   ON customer_treatment_memos(clinic_id);

-- RLS: clinic_id 기준 격리
ALTER TABLE customer_treatment_memos ENABLE ROW LEVEL SECURITY;

-- SELECT: 동일 클리닉 인증 사용자
CREATE POLICY "clinic_isolation_ctm_select" ON customer_treatment_memos
  FOR SELECT TO authenticated
  USING (clinic_id = current_user_clinic_id());

-- INSERT: 동일 클리닉 인증 사용자
CREATE POLICY "clinic_isolation_ctm_insert" ON customer_treatment_memos
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id = current_user_clinic_id());

-- UPDATE: 본인 작성분 (email 기준)
CREATE POLICY "own_update_ctm" ON customer_treatment_memos
  FOR UPDATE TO authenticated
  USING   (created_by = auth.jwt()->>'email')
  WITH CHECK (created_by = auth.jwt()->>'email');

-- DELETE: 본인 작성분 (email 기준)
CREATE POLICY "own_delete_ctm" ON customer_treatment_memos
  FOR DELETE TO authenticated
  USING (created_by = auth.jwt()->>'email');

COMMENT ON TABLE customer_treatment_memos IS
  '치료메모 히스토리 누적 이력 (T-20260520-foot-MEMO-HISTORY). 덮어쓰기 방식에서 누적 방식으로 변경.';
