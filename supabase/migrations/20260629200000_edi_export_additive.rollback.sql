-- ROLLBACK: T-20260629-foot-EDI-EXPORT-IMPL — edi_submissions export 메타 + insurance_claim_items view
-- 비파괴 ADDITIVE 의 역방향. 기존 데이터/정책 무영향(컬럼·뷰만 제거).

DROP VIEW IF EXISTS insurance_claim_items;

ALTER TABLE edi_submissions
  DROP CONSTRAINT IF EXISTS edi_submissions_export_status_chk;

ALTER TABLE edi_submissions
  DROP COLUMN IF EXISTS export_format_version,
  DROP COLUMN IF EXISTS export_status,
  DROP COLUMN IF EXISTS exported_at,
  DROP COLUMN IF EXISTS exported_by,
  DROP COLUMN IF EXISTS export_payload_ref;
