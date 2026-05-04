-- T-20260504-foot-CLINIC-MEMO — 롤백
-- clinic_memos 테이블 DROP

DROP TRIGGER IF EXISTS trg_clinic_memos_updated_at ON clinic_memos;
DROP FUNCTION IF EXISTS update_clinic_memos_updated_at();
DROP TABLE IF EXISTS clinic_memos;
