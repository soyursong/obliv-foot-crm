-- T-20260520-ins-SCHEMA-COMMON (풋센터 적용)
-- T-20260520-foot-INS-UI AC-2
-- 건보 1차 공통 DB 스키마 — insurance_claims / claim_items / claim_diagnoses / edi_submissions
-- Rollback: 20260520000010_insurance_claims_schema.down.sql
-- Created: 2026-05-20 (dev-foot)

-- ============================================================
-- 1) insurance_claims — 진료비 청구 요약
-- ============================================================
CREATE TABLE IF NOT EXISTS insurance_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  check_in_id     UUID REFERENCES check_ins(id) ON DELETE SET NULL,

  visit_date      DATE NOT NULL DEFAULT CURRENT_DATE,

  -- 청구 상태 라이프사이클
  claim_status    TEXT NOT NULL DEFAULT 'draft'
    CHECK (claim_status IN ('draft', 'submitted', 'accepted', 'rejected', 'cancelled')),

  -- 합계 (claim_items 집계 스냅샷)
  total_base          INTEGER NOT NULL DEFAULT 0,
  total_copayment     INTEGER NOT NULL DEFAULT 0,
  total_covered       INTEGER NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at    TIMESTAMPTZ,

  -- 산출 엔진 버전 추적
  calculation_engine_version TEXT DEFAULT 'v1'
);

ALTER TABLE insurance_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ins_claims_auth_all" ON insurance_claims;
CREATE POLICY "ins_claims_auth_all" ON insurance_claims
  FOR ALL TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM staff WHERE user_id = auth.uid()
  ))
  WITH CHECK (clinic_id IN (
    SELECT clinic_id FROM staff WHERE user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_insurance_claims_check_in
  ON insurance_claims(check_in_id) WHERE check_in_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_insurance_claims_customer
  ON insurance_claims(customer_id);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_clinic_date
  ON insurance_claims(clinic_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_status
  ON insurance_claims(clinic_id, claim_status);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_insurance_claims_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_insurance_claims_updated_at ON insurance_claims;
CREATE TRIGGER trg_insurance_claims_updated_at
  BEFORE UPDATE ON insurance_claims
  FOR EACH ROW EXECUTE FUNCTION update_insurance_claims_updated_at();

COMMENT ON TABLE insurance_claims IS
  '건보 진료비 청구 — 접수 1건당 최대 1 draft claim. claim_items 집계. (T-20260520-ins-SCHEMA-COMMON)';

-- ============================================================
-- 2) claim_items — 청구 항목 (서비스별 1행)
-- ============================================================
CREATE TABLE IF NOT EXISTS claim_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id        UUID NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE,
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,

  hira_code       TEXT,
  hira_score      NUMERIC(8,2),
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),

  base_amount         INTEGER NOT NULL DEFAULT 0,
  copayment_amount    INTEGER NOT NULL DEFAULT 0,
  covered_amount      INTEGER NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE claim_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "claim_items_auth_all" ON claim_items;
CREATE POLICY "claim_items_auth_all" ON claim_items
  FOR ALL TO authenticated
  USING (
    claim_id IN (
      SELECT ic.id FROM insurance_claims ic
      INNER JOIN staff s ON s.clinic_id = ic.clinic_id AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    claim_id IN (
      SELECT ic.id FROM insurance_claims ic
      INNER JOIN staff s ON s.clinic_id = ic.clinic_id AND s.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_claim_items_claim
  ON claim_items(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_items_service
  ON claim_items(service_id);

COMMENT ON TABLE claim_items IS
  '청구 항목 — claim 1건당 서비스별 1행. (T-20260520-ins-SCHEMA-COMMON)';

-- ============================================================
-- 3) claim_diagnoses — 청구 상병
-- ============================================================
CREATE TABLE IF NOT EXISTS claim_diagnoses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id        UUID NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE,

  kcd_code        TEXT NOT NULL,           -- KCD 상병코드 (예: B35.1 발백선)
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE claim_diagnoses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "claim_diagnoses_auth_all" ON claim_diagnoses;
CREATE POLICY "claim_diagnoses_auth_all" ON claim_diagnoses
  FOR ALL TO authenticated
  USING (
    claim_id IN (
      SELECT ic.id FROM insurance_claims ic
      INNER JOIN staff s ON s.clinic_id = ic.clinic_id AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    claim_id IN (
      SELECT ic.id FROM insurance_claims ic
      INNER JOIN staff s ON s.clinic_id = ic.clinic_id AND s.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_claim_diagnoses_claim
  ON claim_diagnoses(claim_id);

COMMENT ON TABLE claim_diagnoses IS
  '청구 상병코드 (KCD) — claim당 복수 상병 가능. (T-20260520-ins-SCHEMA-COMMON)';

-- ============================================================
-- 4) edi_submissions — EDI 전송 이력 (2차 EDI 대비, nullable)
-- ============================================================
CREATE TABLE IF NOT EXISTS edi_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id        UUID NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE,

  -- 2차 EDI까지 모두 nullable (1차는 수동 청구)
  edi_status      TEXT CHECK (edi_status IS NULL OR edi_status IN (
                    'pending', 'sent', 'accepted', 'rejected', 'cancelled'
                  )),
  submitted_at    TIMESTAMPTZ,
  response_code   TEXT,
  response_message TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE edi_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "edi_submissions_auth_all" ON edi_submissions;
CREATE POLICY "edi_submissions_auth_all" ON edi_submissions
  FOR ALL TO authenticated
  USING (
    claim_id IN (
      SELECT ic.id FROM insurance_claims ic
      INNER JOIN staff s ON s.clinic_id = ic.clinic_id AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    claim_id IN (
      SELECT ic.id FROM insurance_claims ic
      INNER JOIN staff s ON s.clinic_id = ic.clinic_id AND s.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_edi_submissions_claim
  ON edi_submissions(claim_id);

COMMENT ON TABLE edi_submissions IS
  'EDI 전송 이력 — 2차 EDI 연동 대비 nullable 구조. (T-20260520-ins-SCHEMA-COMMON)';
