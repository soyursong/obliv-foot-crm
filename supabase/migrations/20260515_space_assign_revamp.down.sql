-- ROLLBACK: T-20260515-foot-SPACE-ASSIGN-REVAMP

BEGIN;

-- 6. room_role_mapping 복원: 레이저실 technician → therapist
DELETE FROM room_role_mapping
WHERE room_type = 'laser' AND allowed_role = 'technician'
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1);

INSERT INTO room_role_mapping (clinic_id, room_type, allowed_role)
SELECT id, 'laser', 'therapist'
FROM clinics WHERE slug = 'jongno-foot'
ON CONFLICT (clinic_id, room_type, allowed_role) DO NOTHING;

-- 5. room_assignments 이력 복원
UPDATE room_assignments
SET room_name = '원장실'
WHERE room_name = '원장실 C5'
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1);

UPDATE room_assignments
SET room_name = '레이저실' || substring(room_name FROM 'L(\d+)')
WHERE room_name ~ '^L\d+$'
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1);

UPDATE room_assignments
SET room_name = '치료실' || substring(room_name FROM 'C(\d+)')
WHERE room_name ~ '^C\d+$'
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1);

-- 4. 원장실 C5 → 원장실
UPDATE rooms SET name = '원장실'
WHERE name = '원장실 C5' AND room_type = 'examination'
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1);

-- 3. L1~L12 → 레이저실1~12
UPDATE rooms
SET name = '레이저실' || substring(name FROM 'L(\d+)')
WHERE name ~ '^L\d+$'
  AND room_type = 'laser'
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1);

-- 2. C10 삭제 + treatment_rooms 복원
DELETE FROM rooms
WHERE name = 'C10' AND room_type = 'treatment'
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1);

UPDATE clinics SET treatment_rooms = 9 WHERE slug = 'jongno-foot';

-- 1. C1~C9 → 치료실1~치료실9
UPDATE rooms
SET name = '치료실' || substring(name FROM 'C(\d+)')
WHERE name ~ '^C\d+$'
  AND room_type = 'treatment'
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1);

COMMIT;
