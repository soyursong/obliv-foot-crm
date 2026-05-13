-- T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE
-- 수납 완료 건 수정/취소/삭제 + audit 이력
-- risk: 3/5 — DB 스키마 변경

-- ──────────────────────────────────────────────────────────────
-- 1. payments 테이블 확장
-- ──────────────────────────────────────────────────────────────
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'deleted')),
  ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by    TEXT,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by   TEXT,
  ADD COLUMN IF NOT EXISTS cancel_reason  TEXT;

-- status 인덱스 (active 필터링 성능)
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- ──────────────────────────────────────────────────────────────
-- 2. payment_audit_logs 이력 테이블
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_audit_logs (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id  UUID        NOT NULL,
  clinic_id   UUID        REFERENCES clinics(id),
  check_in_id UUID        REFERENCES check_ins(id),
  action      TEXT        NOT NULL CHECK (action IN ('create','edit','cancel','delete')),
  before_data JSONB,
  after_data  JSONB,
  actor       TEXT,
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_logs_payment ON payment_audit_logs(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_logs_clinic  ON payment_audit_logs(clinic_id, created_at);

-- ──────────────────────────────────────────────────────────────
-- 3. RLS — 전직원 오픈 (AC-6)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE payment_audit_logs ENABLE ROW LEVEL SECURITY;

-- 기존 정책 충돌 방지
DROP POLICY IF EXISTS "payment_audit_logs_open" ON payment_audit_logs;

CREATE POLICY "payment_audit_logs_open" ON payment_audit_logs
  FOR ALL USING (true) WITH CHECK (true);
