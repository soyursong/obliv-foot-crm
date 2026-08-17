-- ============================================================
-- ROLLBACK — T-20260817-foot-RESVSLOT-OPHOURS-0930
--   up(20260817130000_foot_ophours_0930_start.sql) 역전: open_time 09:30 → 09:00 (09-01 세대 dow 1~6 복원).
--   data-only 역전(open_time 1컬럼) · 부모 08-15 세대 자산은 존치(테이블/행 DROP 아님).
--   09:00 = 08-15 배포본 원값 → 부모 세대 상태로 정확 복원.
-- ============================================================
BEGIN;

DO $$
DECLARE
  v_clinic_id UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  v_ef        DATE := DATE '2026-09-01';
  v_reverted  int;
BEGIN
  UPDATE public.clinic_operating_hours
     SET open_time = TIME '09:00'
   WHERE clinic_id      = v_clinic_id
     AND effective_from = v_ef
     AND day_of_week BETWEEN 1 AND 6
     AND open_time <> TIME '09:00';
  GET DIAGNOSTICS v_reverted = ROW_COUNT;
  RAISE NOTICE '[ROLLBACK] open_time 09:00 복원 ROW_COUNT=% (기대=6)', v_reverted;
END $$;

COMMIT;

-- POST-ROLLBACK CHECK
-- [ ] 09-01 세대 dow 1~6 = open_time '09:00' (08-15 배포본 원값)
-- [ ] 마지막 슬롯/close_time/일요일 row-absent 무변(애초 무접촉)
-- [ ] clinic_operating_hours 테이블·행 존치(부모 자산 무손실)
