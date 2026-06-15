-- ============================================================
-- AC-2 APPLY — #A insurance_claims_schema (DRIFT 복구)
-- T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT
-- ============================================================
-- 원천: supabase/migrations/20260520000010_insurance_claims_schema.sql (idempotent 그대로)
-- ★ 2026-06-15 개명(옵션 A) — DA-20260615-foot-INSURANCE-CLAIM-NAMING (cross_crm §14 v1.10):
--   claim_diagnoses → insurance_claim_diagnoses 전면 개명. prod live claim_diagnoses
--   (결제연계 PHI, disease_code) 와의 이름 충돌 해소. live 는 apply/rollback 모두 미접촉.
-- DRIFT 상태(AC-1 ground-truth, 개명 후):
--   MISSING : insurance_claims / claim_items / insurance_claim_diagnoses / edi_submissions (4 신규 생성)
--   UNTOUCHED: claim_diagnoses (결제연계, disease_code) — 본 배치가 생성/접촉하지 않음.
-- live 영향: InsuranceCopaymentPanel.persistCharges() 가 service_charges INSERT 후
--   insurance_claims upsert → 42P01 relation does not exist → "청구 생성 실패" + 부분저장.
--
-- 멱등성: 전부 CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS.
--   → 재실행/부분적용 환경 안전. 개명으로 live claim_diagnoses 정책/데이터 무변경 (DROP POLICY 미발행).
-- 게이트: data-architect CONSULT(PHI/금융 + RLS) GO + supervisor 재-DDL-diff 통과 후에만 _pg --apply.
-- 롤백: A_insurance_claims.scoped_rollback.sql  (신규 4 테이블만 DROP, live claim_diagnoses 보존)
-- author: dev-foot / 2026-06-15 (개명 수정)
-- ============================================================

-- ── 1) insurance_claims — 진료비 청구 요약 ──
CREATE TABLE IF NOT EXISTS insurance_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  check_in_id     UUID REFERENCES check_ins(id) ON DELETE SET NULL,
  visit_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  claim_status    TEXT NOT NULL DEFAULT 'draft'
    CHECK (claim_status IN ('draft', 'submitted', 'accepted', 'rejected', 'cancelled')),
  total_base          INTEGER NOT NULL DEFAULT 0,
  total_copayment     INTEGER NOT NULL DEFAULT 0,
  total_covered       INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at    TIMESTAMPTZ,
  calculation_engine_version TEXT DEFAULT 'v1'
);

ALTER TABLE insurance_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ins_claims_auth_all" ON insurance_claims;
CREATE POLICY "ins_claims_auth_all" ON insurance_claims
  FOR ALL TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid()))
  WITH CHECK (clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_insurance_claims_check_in
  ON insurance_claims(check_in_id) WHERE check_in_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_insurance_claims_customer
  ON insurance_claims(customer_id);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_clinic_date
  ON insurance_claims(clinic_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_status
  ON insurance_claims(clinic_id, claim_status);

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
  '건보 진료비 청구 — 접수 1건당 최대 1 draft claim. claim_items 집계. (T-20260520-ins-SCHEMA-COMMON / parity복구 T-20260615)';

-- ── 2) claim_items — 청구 항목 (서비스별 1행) ──
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
  USING (claim_id IN (
    SELECT ic.id FROM insurance_claims ic
    INNER JOIN staff s ON s.clinic_id = ic.clinic_id AND s.user_id = auth.uid()))
  WITH CHECK (claim_id IN (
    SELECT ic.id FROM insurance_claims ic
    INNER JOIN staff s ON s.clinic_id = ic.clinic_id AND s.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_claim_items_claim ON claim_items(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_items_service ON claim_items(service_id);

COMMENT ON TABLE claim_items IS
  '청구 항목 — claim 1건당 서비스별 1행. (T-20260520-ins-SCHEMA-COMMON / parity복구 T-20260615)';

-- ── 3) insurance_claim_diagnoses — 건보 청구 상병 (KCD) ──
-- ★ 개명(옵션 A): live claim_diagnoses(결제연계, disease_code)와 이름 충돌 해소.
--   건보 신규가 양보 → 고유명 insurance_claim_diagnoses. live claim_diagnoses 미접촉.
--   진단코드 = kcd_code (NHIS=KCD). §12-4 canonical RLS (PHI 인접 EXCL).
CREATE TABLE IF NOT EXISTS insurance_claim_diagnoses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id        UUID NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE,
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  kcd_code        TEXT NOT NULL,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE insurance_claim_diagnoses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insurance_claim_diagnoses_auth_all" ON insurance_claim_diagnoses;
CREATE POLICY "insurance_claim_diagnoses_auth_all" ON insurance_claim_diagnoses
  FOR ALL TO authenticated
  USING (is_approved_user() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_approved_user() AND clinic_id = current_user_clinic_id());

CREATE INDEX IF NOT EXISTS idx_insurance_claim_diagnoses_claim ON insurance_claim_diagnoses(claim_id);
CREATE INDEX IF NOT EXISTS idx_insurance_claim_diagnoses_clinic ON insurance_claim_diagnoses(clinic_id);

COMMENT ON TABLE insurance_claim_diagnoses IS
  '건보 청구 상병코드 (KCD) — claim당 복수 상병. 결제연계 claim_diagnoses(disease_code)와 네임스페이스 분리. 옵션 A 개명 (T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT / DA cross_crm §14 v1.10).';

-- ── 4) edi_submissions — EDI 전송 이력 (2차 EDI 대비, nullable) ──
CREATE TABLE IF NOT EXISTS edi_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id        UUID NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE,
  edi_status      TEXT CHECK (edi_status IS NULL OR edi_status IN (
                    'pending', 'sent', 'accepted', 'rejected', 'cancelled')),
  submitted_at    TIMESTAMPTZ,
  response_code   TEXT,
  response_message TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE edi_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "edi_submissions_auth_all" ON edi_submissions;
CREATE POLICY "edi_submissions_auth_all" ON edi_submissions
  FOR ALL TO authenticated
  USING (claim_id IN (
    SELECT ic.id FROM insurance_claims ic
    INNER JOIN staff s ON s.clinic_id = ic.clinic_id AND s.user_id = auth.uid()))
  WITH CHECK (claim_id IN (
    SELECT ic.id FROM insurance_claims ic
    INNER JOIN staff s ON s.clinic_id = ic.clinic_id AND s.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_edi_submissions_claim ON edi_submissions(claim_id);

COMMENT ON TABLE edi_submissions IS
  'EDI 전송 이력 — 2차 EDI 연동 대비 nullable 구조. (T-20260520-ins-SCHEMA-COMMON / parity복구 T-20260615)';
