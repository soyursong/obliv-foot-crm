-- ROLLBACK: T-20260430-foot-LASER-ROOM-REORDER
-- 20260430130000_laser_rooms_sort_order_fix.sql 롤백용
-- 경고: 마이그레이션 전 sort_order 원본 값을 캡처하지 않아
--       롤백 시 모든 룸을 sort_order = 0 (DEFAULT)으로 리셋합니다.
--       롤백 후 현장에서 룸 순서를 수동 재설정이 필요할 수 있습니다.

UPDATE rooms
SET sort_order = 0
WHERE room_type IN ('treatment', 'laser', 'consultation', 'examination')
  AND active = true;
