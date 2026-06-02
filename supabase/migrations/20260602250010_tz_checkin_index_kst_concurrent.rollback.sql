-- ROLLBACK: T-20260602-foot-TZ-AUDIT-FIX (idx_check_ins_clinic_date KST → UTC date 환원)
--   ⚠ 트랜잭션 밖에서 실행(CONCURRENTLY). ⚠ 환원 시 20260602250000 의 kst_date 쿼리와 표현식 불일치 발생.
--   적용: node scripts/apply_20260602250010_tz_checkin_index_kst_concurrent.mjs --rollback
--   author: dev-foot / 2026-06-02

DROP INDEX IF EXISTS idx_check_ins_clinic_date_utc;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_check_ins_clinic_date_utc
  ON check_ins (clinic_id, (checked_in_at::date));

DROP INDEX IF EXISTS idx_check_ins_clinic_date;

ALTER INDEX idx_check_ins_clinic_date_utc RENAME TO idx_check_ins_clinic_date;
