-- Rollback: T-20260602-foot-SLOT-CAPACITY-3
-- 스냅샷 테이블(_rollback_room_max_occ_20260602)에서 변경 대상 방의 원값 복원.
-- default 일괄복원 금지 — 지점별 원값 보존이 목적.

BEGIN;

UPDATE rooms r
  SET max_occupancy = s.max_occupancy
  FROM _rollback_room_max_occ_20260602 s
  WHERE r.id = s.id;

DROP TABLE IF EXISTS _rollback_room_max_occ_20260602;

COMMIT;
