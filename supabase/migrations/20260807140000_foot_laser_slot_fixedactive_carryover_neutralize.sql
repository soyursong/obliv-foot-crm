-- T-20260806-foot-LASER-SLOT-FIXEDACTIVE
-- 레이저실 슬롯 L2/L6/L7/L12 "기본값 활성"(매일 자동 리셋 활성) 복원.
--
-- 문제(census 근거):
--   L2/L6/L7/L12 는 각각 오래된 carry_over=true, is_active=false 레코드(2026-05~06)를
--   보유 → fetchInactiveRooms(Dashboard.tsx) step2(.eq('carry_over',true))가 이를
--   매일 집어 올려 당일 레코드 없는 날 = 항상 비활성으로 판정. (12개 레이저실 중 이 4개만 해당)
--
-- 수정(Option B, no-DDL 데이터 정정):
--   해당 6행의 carry_over 를 false 로 중화 → step2 에서 더 이상 안 걸림.
--   결과: 당일 레코드 없음 + carry_over=true 없음 → 활성(기본값). 다른 8개 레이저실과 동일.
--   당일 수동 비활성화는 그대로 허용(기존 handleToggleRoom 경로 불변).
--
-- FREEZE SET (census 2026-08-07): 정확히 6행, 단일 clinic 74967aea, is_active=false·carry_over=true.
--   L12 453c4d3c / L2 1c83f226 / L6 44e8e834 / L7 9b9864ce, fb8b0307, 53b91efc
-- 비파괴: 행 삭제 아님(carry_over 플래그만 중화, 과거 disable 감사이력 보존).
-- Rollback: 20260807140000_foot_laser_slot_fixedactive_carryover_neutralize.rollback.sql
-- Ticket:   T-20260806-foot-LASER-SLOT-FIXEDACTIVE
-- Applied:  2026-08-07 prod rxlomoozakkjesdqjtvd (Management query API, status 201, rows_affected=6).
--   Renamed 20260807100000→20260807140000: version 20260807100000 already held by
--   foot_rls_adminfunc_ungated_gate_sweep in schema_migrations (collision avoidance).
--   no-DDL data-correction → intentionally NOT registered in supabase_migrations
--   (forward-doc/record only). Post-apply verify: carry_over=true+inactive 6→0.

BEGIN;

DO $$
DECLARE n integer;
BEGIN
  UPDATE daily_room_status
     SET carry_over = false
   WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
     AND room_name IN ('L2','L6','L7','L12')
     AND carry_over = true
     AND is_active  = false;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 6 THEN
    RAISE EXCEPTION 'LASER-SLOT-FIXEDACTIVE: expected 6 rows (frozen census set), got %. Aborting.', n;
  END IF;
END $$;

COMMIT;

-- 검증 (apply 후):
-- SELECT count(*) FROM daily_room_status
--  WHERE room_name IN ('L2','L6','L7','L12') AND carry_over=true AND is_active=false;  -- 기대: 0
