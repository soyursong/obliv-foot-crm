-- MSG-20260422-1455: 표준처방코드 + 서류 출력 스키마
-- 3 tables: prescription_codes, form_templates, form_submissions

-- 1. 표준처방코드
CREATE TABLE IF NOT EXISTS prescription_codes (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_code      TEXT NOT NULL UNIQUE,
  name_ko         TEXT NOT NULL,
  code_type       TEXT NOT NULL DEFAULT '국산보험등재약',
  classification  TEXT NOT NULL DEFAULT '내복약',
  manufacturer    TEXT,
  anti_dropout    BOOLEAN NOT NULL DEFAULT FALSE,
  relative_value  NUMERIC(10,5) DEFAULT 0,
  ingredient_code TEXT,
  low_dose        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescription_codes_claim ON prescription_codes(claim_code);
CREATE INDEX IF NOT EXISTS idx_prescription_codes_name ON prescription_codes USING gin(to_tsvector('simple', name_ko));
CREATE INDEX IF NOT EXISTS idx_prescription_codes_ingredient ON prescription_codes(ingredient_code);

ALTER TABLE prescription_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prescription_codes_read_all" ON prescription_codes FOR SELECT USING (true);

-- 2. 서류 템플릿
CREATE TABLE IF NOT EXISTS form_templates (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id         UUID NOT NULL REFERENCES clinics(id),
  category          TEXT NOT NULL CHECK (category IN ('foot-service', 'dosu-center')),
  form_key          TEXT NOT NULL,
  name_ko           TEXT NOT NULL,
  template_path     TEXT NOT NULL,
  template_format   TEXT NOT NULL CHECK (template_format IN ('jpg', 'png', 'pdf')),
  field_map         JSONB NOT NULL DEFAULT '[]',
  requires_signature BOOLEAN DEFAULT FALSE,
  required_role     TEXT DEFAULT NULL,
  active            BOOLEAN DEFAULT TRUE,
  sort_order        INT DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(clinic_id, form_key)
);

ALTER TABLE form_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "form_templates_read" ON form_templates FOR SELECT USING (true);
CREATE POLICY "form_templates_manage" ON form_templates FOR ALL USING (
  clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid())
);

-- 3. 서류 발행 기록
CREATE TABLE IF NOT EXISTS form_submissions (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id         UUID NOT NULL REFERENCES clinics(id),
  template_id       UUID NOT NULL REFERENCES form_templates(id),
  check_in_id       UUID REFERENCES check_ins(id),
  customer_id       UUID NOT NULL REFERENCES customers(id),
  issued_by         UUID NOT NULL REFERENCES staff(id),
  field_data        JSONB NOT NULL DEFAULT '{}',
  prescription_ids  UUID[] DEFAULT '{}',
  diagnosis_codes   TEXT[] DEFAULT '{}',
  signature_url     TEXT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'printed', 'signed', 'voided')),
  printed_at        TIMESTAMPTZ,
  signed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_customer ON form_submissions(customer_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_clinic ON form_submissions(clinic_id, created_at DESC);

ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "form_submissions_read" ON form_submissions FOR SELECT USING (
  clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid())
);
CREATE POLICY "form_submissions_insert" ON form_submissions FOR INSERT WITH CHECK (
  clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid())
);
CREATE POLICY "form_submissions_update" ON form_submissions FOR UPDATE USING (
  clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid())
);
