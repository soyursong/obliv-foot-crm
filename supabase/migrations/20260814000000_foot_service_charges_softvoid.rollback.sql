-- ROLLBACK — T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK CARVE-A (service_charges soft-void)
-- ADDITIVE 역전: 신규 3컬럼 DROP. 기존 data 무손실(컬럼 자체가 신규·backfill 0).
-- ★배포순서: FE(`.is('voided_at', null)` 필터·handleDeleteItem softvoid UPDATE) 롤백/미배포 상태에서만 실행.
--   컬럼 DROP 시 FE 잔존하면 "column does not exist" 오류.
BEGIN;

ALTER TABLE service_charges DROP COLUMN IF EXISTS voided_by;
ALTER TABLE service_charges DROP COLUMN IF EXISTS voided_reason;
ALTER TABLE service_charges DROP COLUMN IF EXISTS voided_at;

COMMIT;
