-- ROLLBACK T-20260603-foot-RX-CHART-ENHANCE AC-2: prescription_contraindications 제거
-- 주의: 등록된 금기증 데이터 전부 소실. 롤백 전 백업 필수.
DROP POLICY IF EXISTS rx_contra_admin_write ON prescription_contraindications;
DROP POLICY IF EXISTS rx_contra_read ON prescription_contraindications;
DROP TABLE IF EXISTS prescription_contraindications;
