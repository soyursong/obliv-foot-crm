-- ROLLBACK: T-20260806-foot-LASER-SLOT-FIXEDACTIVE
-- forward 에서 carry_over=false 로 중화한 정확히 그 6행(frozen id)만 carry_over=true 로 복원.
-- (is_active 는 forward 에서 건드리지 않았으므로 복원 불요.)

BEGIN;

UPDATE daily_room_status
   SET carry_over = true
 WHERE id IN (
   '453c4d3c-c2b7-43c5-8edf-95e4f11573bb',  -- L12 2026-05-25
   '1c83f226-ec0a-454e-a8dd-0b6b4b61868a',  -- L2  2026-05-24
   '44e8e834-41fc-4d02-ace1-54b786d8a681',  -- L6  2026-05-25
   '9b9864ce-6b39-4ced-ac2f-266e2ac45a14',  -- L7  2026-05-25
   'fb8b0307-fc9d-49ba-a6a0-2ddaa622e042',  -- L7  2026-06-10
   '53b91efc-fb29-4605-aa4a-f40711274fd5'   -- L7  2026-06-11
 )
   AND is_active = false;

COMMIT;
