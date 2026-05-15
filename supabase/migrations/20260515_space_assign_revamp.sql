-- T-20260515-foot-SPACE-ASSIGN-REVAMP
-- 공간배정 실제 원내 기준 전면 재정비
-- Rollback: 20260515_space_assign_revamp.down.sql
-- Risk: GO_WARN (2/5) — 비즈로직 변경(지속성 모델 전환) + DB 룸 정의 변경

BEGIN;

-- =============================================================
-- 1. 치료실 슬롯: 치료실1~9 → C1~C9 (rooms table)
-- =============================================================
UPDATE rooms
SET name = 'C' || substring(name FROM '치료실(\d+)')
WHERE name ~ '^치료실\d+$'
  AND room_type = 'treatment'
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1);

-- =============================================================
-- 2. C10 신설 (치료실 9→10)
-- =============================================================
INSERT INTO rooms (clinic_id, name, room_type, sort_order, active)
SELECT id, 'C10', 'treatment', 10, true
FROM clinics WHERE slug = 'jongno-foot'
ON CONFLICT DO NOTHING;

UPDATE clinics SET treatment_rooms = 10 WHERE slug = 'jongno-foot';

-- =============================================================
-- 3. 레이저실 표기명: 레이저실1~12 → L1~L12 (rooms table)
-- =============================================================
UPDATE rooms
SET name = 'L' || substring(name FROM '레이저실(\d+)')
WHERE name ~ '^레이저실\d+$'
  AND room_type = 'laser'
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1);

-- =============================================================
-- 4. 원장실 표기명: 원장실 → 원장실 C5 (rooms table)
-- =============================================================
UPDATE rooms
SET name = '원장실 C5'
WHERE name = '원장실'
  AND room_type = 'examination'
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1);

-- =============================================================
-- 5. 기존 room_assignments 이력 동기화 (room_name 컬럼 값 변경)
-- =============================================================

-- 치료실 → C (historical)
UPDATE room_assignments
SET room_name = 'C' || substring(room_name FROM '치료실(\d+)')
WHERE room_name ~ '^치료실\d+$'
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1);

-- 레이저실 → L (historical)
UPDATE room_assignments
SET room_name = 'L' || substring(room_name FROM '레이저실(\d+)')
WHERE room_name ~ '^레이저실\d+$'
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1);

-- 원장실 → 원장실 C5 (historical)
UPDATE room_assignments
SET room_name = '원장실 C5'
WHERE room_name = '원장실'
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1);

-- =============================================================
-- 6. room_role_mapping 변경: 레이저실 담당자 치료사→장비명(technician)
-- AC-8: 레이저실 드롭다운 소스를 [장비명] 카테고리(technician)로 변경
-- =============================================================
DELETE FROM room_role_mapping
WHERE room_type = 'laser'
  AND allowed_role = 'therapist'
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1);

INSERT INTO room_role_mapping (clinic_id, room_type, allowed_role)
SELECT id, 'laser', 'technician'
FROM clinics WHERE slug = 'jongno-foot'
ON CONFLICT (clinic_id, room_type, allowed_role) DO NOTHING;

COMMIT;
