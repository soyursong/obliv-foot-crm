-- ============================================================
-- 청구·서류 DB 스키마
-- 동의서(#11), 급여코드 청구(#12), 보험 영수증(#13), 처방전(#14),
-- 본인부담금 조회(#20) 공통 기반
-- ============================================================

-- 1. consent_templates — PDF 양식 마스터 (병원에서 1회 업로드)
CREATE TABLE IF NOT EXISTS consent_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  name TEXT NOT NULL,                              -- "개인정보 수집·이용 동의"
  kind TEXT NOT NULL CHECK (kind IN (
    'privacy','treatment','non_covered','photo','refund','anesthesia','other'
  )),
  pdf_url TEXT NOT NULL,                           -- Storage path: signatures/templates/{uuid}.pdf
  active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(clinic_id, kind, active)                  -- 활성 양식은 kind당 1개
);
CREATE INDEX IF NOT EXISTS idx_consent_templates_clinic ON consent_templates(clinic_id, active);

-- 2. consent_forms 확장 — 기존 테이블에 template_id, signed_pdf_url 추가
ALTER TABLE consent_forms
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES consent_templates(id),
  ADD COLUMN IF NOT EXISTS signed_pdf_url TEXT;    -- 서명 완료 PDF (서명 오버레이 후)

-- 3. payment_codes — 건강보험 행위코드 마스터 (내일 고객 제공 예정, 스키마만 준비)
CREATE TABLE IF NOT EXISTS payment_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                       -- EDI 코드 (예: MM010)
  name TEXT NOT NULL,                              -- "광선치료"
  category TEXT,                                   -- "광선치료", "물리치료" 등
  base_price INTEGER NOT NULL DEFAULT 0,           -- 수가 (원)
  default_copay_rate NUMERIC(4,2) DEFAULT 0.70,   -- 기본 본인부담률 (0.70 = 70%)
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. service_payment_codes — 시술 ↔ 급여코드 매핑 (다대다)
CREATE TABLE IF NOT EXISTS service_payment_codes (
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  code_id UUID NOT NULL REFERENCES payment_codes(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, code_id)
);

-- 5. payment_code_claims — 급여 청구 기록 (체크인별)
CREATE TABLE IF NOT EXISTS payment_code_claims (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  check_in_id UUID NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id),
  code_id UUID NOT NULL REFERENCES payment_codes(id),
  quantity INTEGER DEFAULT 1,
  total_amount INTEGER NOT NULL,                   -- 총 수가
  insurance_amount INTEGER NOT NULL,               -- 공단부담금
  copayment INTEGER NOT NULL,                      -- 본인부담금
  copay_rate NUMERIC(4,2) NOT NULL,                -- 적용된 본인부담률 (7세 미만, 일반 등)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitted','approved','rejected','cancelled')),
  submitted_at TIMESTAMPTZ,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_code_claims_checkin ON payment_code_claims(check_in_id);
CREATE INDEX IF NOT EXISTS idx_payment_code_claims_status ON payment_code_claims(clinic_id, status);

-- 6. insurance_receipts — 실손보험 진료비 영수증 / 세부내역서
CREATE TABLE IF NOT EXISTS insurance_receipts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  check_in_id UUID NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  receipt_type TEXT NOT NULL CHECK (receipt_type IN ('receipt','detail')),
  -- 영수증(receipt): 진료비 영수증, 세부내역서(detail): 세부항목 포함본
  receipt_no TEXT,                                 -- 영수증 번호 (병원 자체 채번)
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- 금액 요약
  consult_amount INTEGER DEFAULT 0,                -- 진찰료
  treatment_amount INTEGER DEFAULT 0,              -- 시술료
  medicine_amount INTEGER DEFAULT 0,               -- 약제비
  test_amount INTEGER DEFAULT 0,                   -- 검사료
  material_amount INTEGER DEFAULT 0,               -- 재료비
  insurance_covered INTEGER DEFAULT 0,             -- 급여 (공단+본인부담)
  non_covered INTEGER DEFAULT 0,                   -- 비급여
  total_amount INTEGER NOT NULL,                   -- 총액
  paid_amount INTEGER NOT NULL,                    -- 실제 납부액

  -- 세부 항목 (세부내역서용 JSONB)
  detail_items JSONB,
  -- [{ category, name, unit_price, qty, amount, category_type: 'covered'|'non_covered' }]

  pdf_url TEXT,                                    -- 생성된 PDF
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_receipts_customer ON insurance_receipts(customer_id);
CREATE INDEX IF NOT EXISTS idx_insurance_receipts_checkin ON insurance_receipts(check_in_id);

-- 7. prescriptions — 처방전
CREATE TABLE IF NOT EXISTS prescriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  check_in_id UUID REFERENCES check_ins(id) ON DELETE SET NULL,
  customer_id UUID NOT NULL REFERENCES customers(id),
  prescribed_by UUID REFERENCES staff(id),         -- 원장
  prescribed_by_name TEXT,                         -- staff 참조 없이도 기록
  license_no TEXT,                                 -- 면허번호 (인쇄용)
  prescribed_at TIMESTAMPTZ DEFAULT now(),
  diagnosis TEXT,                                  -- 진단명
  memo TEXT,
  pdf_url TEXT,                                    -- 생성된 PDF
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prescriptions_customer ON prescriptions(customer_id);

-- 8. prescription_items — 처방 항목 (1:N)
CREATE TABLE IF NOT EXISTS prescription_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medication_name TEXT NOT NULL,                   -- 의약품명
  dosage TEXT,                                     -- "1정 1일 3회" 등 자유 텍스트
  duration_days INTEGER,                           -- 처방일수
  quantity INTEGER,                                -- 총 처방량
  memo TEXT,
  sort_order INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prescription_items_prescription ON prescription_items(prescription_id);

-- 9. medications — (옵션) 자주 쓰는 의약품 마스터. 내일 고객 제공 예정
CREATE TABLE IF NOT EXISTS medications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  name TEXT NOT NULL,
  standard_dosage TEXT,                            -- 기본 용법 (빠른 입력용)
  standard_duration_days INTEGER,
  category TEXT,                                   -- "진통제", "항생제" 등
  active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medications_clinic ON medications(clinic_id, active);

-- ============================================================
-- RLS 활성화 + authenticated 풀 액세스 (승인 유저 기준)
-- ============================================================
ALTER TABLE consent_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_codes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_payment_codes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_code_claims    ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_receipts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescription_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications            ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all" ON consent_templates      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON payment_codes          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON service_payment_codes  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON payment_code_claims    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON insurance_receipts     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON prescriptions          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON prescription_items     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON medications            FOR ALL TO authenticated USING (true) WITH CHECK (true);
