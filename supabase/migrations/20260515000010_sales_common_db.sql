-- T-20260515-foot-SALES-COMMON-DB
-- 매출집계 모듈 공통 DB: ALTER TABLE x6 nullable + claim_diagnoses 정규화 + parent_payment_id FK
-- GO_WARN: DB 스키마 변경. 롤백: 20260515000010_sales_common_db.down.sql
--
-- 원칙: 기존 결제 플로우 코드 수정 없음 (READ-ONLY 집계 설계).
--        신규 컬럼 전부 nullable — 기존 결제 INSERT 무영향.
--        집계 기준: accounting_date (소급 변동 차단).

-- ──────────────────────────────────────────────────────────────────────
-- 1. payments 테이블 확장 (6 nullable 컬럼)
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS accounting_date     DATE,        -- 회계귀속일 (자금이동일)
  ADD COLUMN IF NOT EXISTS origin_tx_date      DATE,        -- 원거래일 (환불 시 원거래 추적)
  ADD COLUMN IF NOT EXISTS tax_type            TEXT         -- 세금속성
    CHECK (tax_type IS NULL OR tax_type IN ('과세_비급여','면세_비급여','급여','선수금')),
  ADD COLUMN IF NOT EXISTS appr_info           TEXT,        -- VAN 승인정보 (카드사명+승인번호)
  ADD COLUMN IF NOT EXISTS exclude_tax_report  BOOLEAN DEFAULT FALSE,  -- 연말정산제외
  ADD COLUMN IF NOT EXISTS parent_payment_id   UUID REFERENCES payments(id);  -- 환불 원거래 FK

-- ──────────────────────────────────────────────────────────────────────
-- 2. package_payments 테이블 확장 (6 nullable 컬럼)
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE package_payments
  ADD COLUMN IF NOT EXISTS accounting_date     DATE,
  ADD COLUMN IF NOT EXISTS origin_tx_date      DATE,
  ADD COLUMN IF NOT EXISTS tax_type            TEXT
    CHECK (tax_type IS NULL OR tax_type IN ('과세_비급여','면세_비급여','급여','선수금')),
  ADD COLUMN IF NOT EXISTS appr_info           TEXT,
  ADD COLUMN IF NOT EXISTS exclude_tax_report  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS parent_payment_id   UUID REFERENCES package_payments(id);

-- ──────────────────────────────────────────────────────────────────────
-- 3. accounting_date 기존 데이터 backfill
--    (Asia/Seoul 기준 날짜 — 소급 차단 원칙 준수)
-- ──────────────────────────────────────────────────────────────────────
UPDATE payments
  SET accounting_date = (created_at AT TIME ZONE 'Asia/Seoul')::date
  WHERE accounting_date IS NULL;

UPDATE package_payments
  SET accounting_date = (created_at AT TIME ZONE 'Asia/Seoul')::date
  WHERE accounting_date IS NULL;

-- ──────────────────────────────────────────────────────────────────────
-- 4. 인덱스
-- ──────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payments_accounting_date
  ON payments (clinic_id, accounting_date);

CREATE INDEX IF NOT EXISTS idx_pkg_payments_accounting_date
  ON package_payments (clinic_id, accounting_date);

CREATE INDEX IF NOT EXISTS idx_payments_parent
  ON payments (parent_payment_id) WHERE parent_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pkg_payments_parent
  ON package_payments (parent_payment_id) WHERE parent_payment_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────
-- 5. claim_diagnoses 정규화 테이블 (B안 확정)
--    단건결제(payment_id) 또는 패키지결제(package_payment_id) 중 하나에 귀속.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS claim_diagnoses (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id           UUID        REFERENCES payments(id) ON DELETE CASCADE,
  package_payment_id   UUID        REFERENCES package_payments(id) ON DELETE CASCADE,
  clinic_id            UUID        REFERENCES clinics(id),
  disease_code         TEXT        NOT NULL,   -- ICD-10 상병코드 (예: B351, L600)
  disease_name         TEXT,                   -- 상병명 (예: 손발톱백선)
  sort_order           INTEGER     DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT now(),
  -- 단건결제 or 패키지결제 중 정확히 하나에 귀속
  CONSTRAINT claim_diagnoses_source_check CHECK (
    (payment_id IS NOT NULL AND package_payment_id IS NULL) OR
    (payment_id IS NULL AND package_payment_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_claim_diagnoses_payment
  ON claim_diagnoses (payment_id) WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_claim_diagnoses_pkg_payment
  ON claim_diagnoses (package_payment_id) WHERE package_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_claim_diagnoses_clinic
  ON claim_diagnoses (clinic_id, disease_code);

-- ──────────────────────────────────────────────────────────────────────
-- 6. RLS — 기존 auth_all 패턴 적용
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE claim_diagnoses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "claim_diagnoses_auth_all" ON claim_diagnoses;
CREATE POLICY "claim_diagnoses_auth_all" ON claim_diagnoses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────────────
-- 7. 코멘트
-- ──────────────────────────────────────────────────────────────────────
COMMENT ON COLUMN payments.accounting_date    IS '회계귀속일 (집계 기준). 소급 차단 원칙 — 과거 마감 재수정 금지.';
COMMENT ON COLUMN payments.origin_tx_date     IS '원거래일 (환불/차감 시 원 결제 발생일 추적)';
COMMENT ON COLUMN payments.tax_type           IS '세금속성: 과세_비급여/면세_비급여/급여/선수금';
COMMENT ON COLUMN payments.appr_info          IS 'VAN 승인정보: 카드사명 + 승인번호';
COMMENT ON COLUMN payments.exclude_tax_report IS '연말정산 소득공제 제외 여부';
COMMENT ON COLUMN payments.parent_payment_id  IS '환불 원거래 FK (환불건은 원결제 payments.id 참조)';

COMMENT ON COLUMN package_payments.accounting_date    IS '회계귀속일 (집계 기준)';
COMMENT ON COLUMN package_payments.origin_tx_date     IS '원거래일 (환불 시 원거래 추적)';
COMMENT ON COLUMN package_payments.tax_type           IS '세금속성: 과세_비급여/면세_비급여/급여/선수금';
COMMENT ON COLUMN package_payments.appr_info          IS 'VAN 승인정보';
COMMENT ON COLUMN package_payments.exclude_tax_report IS '연말정산 소득공제 제외 여부';
COMMENT ON COLUMN package_payments.parent_payment_id  IS '환불 원거래 FK';

COMMENT ON TABLE claim_diagnoses IS
  'T-20260515-foot-SALES-COMMON-DB: 결제별 ICD-10 상병코드 정규화 테이블 (B안). '
  '단건결제(payment_id) 또는 패키지결제(package_payment_id) 중 하나에 귀속.';

-- ──────────────────────────────────────────────────────────────────────
-- 8. accounting_date 자동 채우기 트리거
--    기존 결제 플로우 코드 수정 없음(READ-ONLY 원칙).
--    신규 INSERT 시 accounting_date가 NULL이면 Asia/Seoul 기준 오늘 날짜 자동 설정.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_payments_set_accounting_date()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.accounting_date IS NULL THEN
    NEW.accounting_date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_accounting_date_insert ON payments;
CREATE TRIGGER trg_payments_accounting_date_insert
  BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_payments_set_accounting_date();

CREATE OR REPLACE FUNCTION trg_pkg_payments_set_accounting_date()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.accounting_date IS NULL THEN
    NEW.accounting_date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pkg_payments_accounting_date_insert ON package_payments;
CREATE TRIGGER trg_pkg_payments_accounting_date_insert
  BEFORE INSERT ON package_payments
  FOR EACH ROW EXECUTE FUNCTION trg_pkg_payments_set_accounting_date();
