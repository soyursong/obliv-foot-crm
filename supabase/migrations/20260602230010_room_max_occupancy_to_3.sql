-- T-20260602-foot-SLOT-CAPACITY-3 — 상담실/치료실 슬롯 최대 3명 수용
--
-- planner DECISION = A안(데이터 마이그) 채택 + 가드 (re: MSG-20260602-182430 / 18:30).
--   현장 요구: 기존 상담실/치료실 슬롯이 3명 수용. FE 는 rooms.max_occupancy 를
--   동적 참조(Dashboard.tsx L1159/L5309/L809/L4091)하므로 FE 코드 변경 불필요.
--   신규 방 생성은 이미 max_occupancy:3 하드코딩(L4606) → 추가 작업 없음.
--
-- 가드:
--   - WHERE max_occupancy < 3 : 어떤 지점이 의도적으로 3 초과(예: 4)로 설정한 값은
--     덮어쓰지 않음(지점 커스텀 보존). 1·2 → 3 으로만 상향.
--   - examination/laser 는 요구 외 → 미변경(1 유지).
--
-- 롤백 안전:
--   - 마이그 직전 스냅샷 테이블(_rollback_room_max_occ_20260602)에 변경 대상 원값 보존.
--   - 롤백은 스냅샷에서 원복(default 일괄복원 금지 — 지점별 원값 보존).
--
-- 운영 DB 적용은 supervisor 게이트 (QA-REQUEST 시 본 파일 + 롤백 동봉).
-- 롤백: 20260602230010_room_max_occupancy_to_3.rollback.sql

BEGIN;

-- 1) 변경 대상(consultation/treatment) 원값 스냅샷 (롤백 원천)
DROP TABLE IF EXISTS _rollback_room_max_occ_20260602;
CREATE TABLE _rollback_room_max_occ_20260602 AS
  SELECT id, room_type, max_occupancy
  FROM rooms
  WHERE room_type IN ('consultation', 'treatment');

-- 2) 상담실/치료실 수용 인원 3 으로 상향 (3 초과 커스텀 값은 보존)
UPDATE rooms
  SET max_occupancy = 3
  WHERE room_type IN ('consultation', 'treatment')
    AND max_occupancy < 3;

COMMIT;
