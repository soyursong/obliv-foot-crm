-- ROLLBACK: T-20260603-foot-CHART-SPECIAL-NOTE
-- 20260603050000_customer_special_notes.sql 롤백.
-- 신규 테이블만 생성했으므로 테이블 DROP 만으로 완전 원복(기존 스키마/데이터 무영향).
-- 주의: 운영 후 롤백 시 누적된 특이사항 데이터가 함께 삭제됨 → 롤백 전 백업 권장.

BEGIN;

DROP POLICY IF EXISTS "own_delete_csn"             ON customer_special_notes;
DROP POLICY IF EXISTS "own_update_csn"             ON customer_special_notes;
DROP POLICY IF EXISTS "clinic_isolation_csn_insert" ON customer_special_notes;
DROP POLICY IF EXISTS "clinic_isolation_csn_select" ON customer_special_notes;

DROP INDEX IF EXISTS idx_csn_clinic_id;
DROP INDEX IF EXISTS idx_csn_customer_id;

DROP TABLE IF EXISTS customer_special_notes;

COMMIT;
