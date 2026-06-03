-- ROLLBACK T-20260603-foot-RX-CHART-ENHANCE AC-5: 처방항목 JSONB COMMENT 환원
-- JSONB 내부 키는 schema-on-read 이므로 구조 롤백 대상 없음. COMMENT 만 환원.
COMMENT ON COLUMN prescription_sets.items IS NULL;
COMMENT ON COLUMN medical_charts.prescription_items IS NULL;
