-- T-20260430-foot-CONSENT-FORMS — consent_forms 테이블
-- 환불·비급여·시술·개인정보 동의서 전자서명 저장
-- 2026-05-06 dev-foot

CREATE TABLE IF NOT EXISTS consent_forms (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID        NOT NULL REFERENCES clinics(id),
  customer_id  UUID        NOT NULL REFERENCES customers(id),
  check_in_id  UUID        REFERENCES check_ins(id),
  form_type    TEXT        NOT NULL CHECK (form_type IN ('refund','non_covered','treatment','privacy')),
  form_data    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  signature_url TEXT,
  pdf_url      TEXT,
  signed_at    TIMESTAMPTZ DEFAULT now(),
  signed_by_name TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE consent_forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_users_all" ON consent_forms;
CREATE POLICY "auth_users_all" ON consent_forms
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_consent_forms_customer  ON consent_forms(customer_id);
CREATE INDEX IF NOT EXISTS idx_consent_forms_check_in  ON consent_forms(check_in_id);
CREATE INDEX IF NOT EXISTS idx_consent_forms_clinic    ON consent_forms(clinic_id);
