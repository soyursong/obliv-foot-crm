-- ROLLBACK — T-20260806-dopamine-COMPANION-CHECKIN-FOOT-JONGNO-FIX (FK ADDITIVE)
-- ADDITIVE 역: index DROP → column DROP. 데이터 무손실(NULL default 컬럼 · 참조 무결성 SET NULL).
DROP INDEX IF EXISTS public.idx_reservations_companion_of;

ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS companion_of_reservation_id;
