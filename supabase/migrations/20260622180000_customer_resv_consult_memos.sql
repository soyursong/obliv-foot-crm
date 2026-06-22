-- T-20260622-foot-CHART2-MEMO-HISTORY (item4)
-- 예약메모(customers.customer_memo)·상담메모(customers.tm_memo)를 치료메모처럼 히스토리 누적 저장.
-- customer_treatment_memos 패턴 복제 (DA CONSULT MSG-20260622-194449-vq7a 옵션A GO, ADDITIVE).
-- 기존 customers.customer_memo / customers.tm_memo 컬럼은 보존(미삭제) — lazy-migration은 FE 처리. ADDITIVE.
-- 롤백: 20260622180000_customer_resv_consult_memos.down.sql

-- ── 예약메모 히스토리 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_reservation_memos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  clinic_id       uuid        NOT NULL REFERENCES clinics(id)   ON DELETE CASCADE,
  content         text        NOT NULL,
  created_by      text,        -- 작성자 email (auth.jwt()->>'email')
  created_by_name text,        -- 표시 이름
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_customer_id ON customer_reservation_memos(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_clinic_id   ON customer_reservation_memos(clinic_id);

ALTER TABLE customer_reservation_memos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic_isolation_crm_select" ON customer_reservation_memos
  FOR SELECT TO authenticated
  USING (clinic_id = current_user_clinic_id());

CREATE POLICY "clinic_isolation_crm_insert" ON customer_reservation_memos
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id = current_user_clinic_id());

CREATE POLICY "own_update_crm" ON customer_reservation_memos
  FOR UPDATE TO authenticated
  USING   (created_by = auth.jwt()->>'email')
  WITH CHECK (created_by = auth.jwt()->>'email');

CREATE POLICY "own_delete_crm" ON customer_reservation_memos
  FOR DELETE TO authenticated
  USING (created_by = auth.jwt()->>'email');

COMMENT ON TABLE customer_reservation_memos IS
  '예약메모 히스토리 누적 이력 (T-20260622-foot-CHART2-MEMO-HISTORY). customers.customer_memo 덮어쓰기 → 누적. customer_treatment_memos 패턴 복제.';

-- ── 상담메모 히스토리 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_consult_memos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  clinic_id       uuid        NOT NULL REFERENCES clinics(id)   ON DELETE CASCADE,
  content         text        NOT NULL,
  created_by      text,        -- 작성자 email (auth.jwt()->>'email')
  created_by_name text,        -- 표시 이름
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccm_customer_id ON customer_consult_memos(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ccm_clinic_id   ON customer_consult_memos(clinic_id);

ALTER TABLE customer_consult_memos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic_isolation_ccm_select" ON customer_consult_memos
  FOR SELECT TO authenticated
  USING (clinic_id = current_user_clinic_id());

CREATE POLICY "clinic_isolation_ccm_insert" ON customer_consult_memos
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id = current_user_clinic_id());

CREATE POLICY "own_update_ccm" ON customer_consult_memos
  FOR UPDATE TO authenticated
  USING   (created_by = auth.jwt()->>'email')
  WITH CHECK (created_by = auth.jwt()->>'email');

CREATE POLICY "own_delete_ccm" ON customer_consult_memos
  FOR DELETE TO authenticated
  USING (created_by = auth.jwt()->>'email');

COMMENT ON TABLE customer_consult_memos IS
  '상담메모 히스토리 누적 이력 (T-20260622-foot-CHART2-MEMO-HISTORY). customers.tm_memo 덮어쓰기 → 누적. customer_treatment_memos 패턴 복제.';
