-- ROLLBACK — 20260806194200_foot_service_charges_manual_grade_backfill.sql
-- freeze 스냅샷 기준 id 별 'manual' 원복 후 아카이브 테이블 제거.
-- (본 배포와 동반된 INSERT 가드는 BEFORE INSERT 전용이라 UPDATE 원복을 차단하지 않음.)

UPDATE service_charges sc
SET customer_grade_at_charge = f.old_grade   -- = 'manual'
FROM _backfill_sc_manual_grade_20260806 f
WHERE sc.id = f.id
  AND sc.customer_grade_at_charge = 'unverified';

DROP TABLE IF EXISTS _backfill_sc_manual_grade_20260806;
