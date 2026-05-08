-- T-20260508-foot-ROOM-STAFF-LINK
-- 공간 유형별 허용 직원 역할 매핑 (B안)
-- room_type × allowed_role 조합으로 드롭다운 필터링

CREATE TABLE IF NOT EXISTS room_role_mapping (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  room_type    text NOT NULL, -- treatment | laser | consultation | examination
  allowed_role text NOT NULL, -- therapist | consultant | coordinator | director | technician
  created_at   timestamptz DEFAULT now(),
  UNIQUE (clinic_id, room_type, allowed_role)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_room_role_mapping_clinic
  ON room_role_mapping (clinic_id, room_type);

-- RLS
ALTER TABLE room_role_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "room_role_read" ON room_role_mapping
  FOR SELECT USING (true);

CREATE POLICY "room_role_write" ON room_role_mapping
  FOR ALL USING (
    clinic_id IN (
      SELECT clinic_id FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager') AND active = true
    )
  );

-- Seed: 모든 기존 클리닉에 기본 매핑 삽입
-- 치료실·레이저실 → 치료사 / 상담실 → 상담실장 / 원장실 → 원장
INSERT INTO room_role_mapping (clinic_id, room_type, allowed_role)
SELECT id, 'treatment', 'therapist' FROM clinics
UNION ALL
SELECT id, 'laser', 'therapist' FROM clinics
UNION ALL
SELECT id, 'consultation', 'consultant' FROM clinics
UNION ALL
SELECT id, 'examination', 'director' FROM clinics
ON CONFLICT (clinic_id, room_type, allowed_role) DO NOTHING;

-- 롤백:
-- DROP TABLE IF EXISTS room_role_mapping;
