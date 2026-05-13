-- T-20260513-foot-C1-SPACE-ASSIGN-RESTORE: 공간배정 이동이력 추적 테이블
-- 금일 이동이력 표시 (중복 제거, 당일만, 날짜 변경 시 자동 리셋)

CREATE TABLE IF NOT EXISTS check_in_room_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_id UUID NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  assigned_room TEXT NOT NULL,
  room_type   TEXT NOT NULL CHECK (room_type IN ('examination', 'consultation', 'treatment', 'laser')),
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  logged_by   UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_room_logs_check_in
  ON check_in_room_logs(check_in_id, logged_at);

CREATE INDEX IF NOT EXISTS idx_room_logs_clinic_date
  ON check_in_room_logs(clinic_id, ((logged_at AT TIME ZONE 'Asia/Seoul')::date));

-- RLS
ALTER TABLE check_in_room_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "room_logs_clinic_access" ON check_in_room_logs
  FOR ALL USING (
    clinic_id IN (
      SELECT clinic_id FROM user_profiles WHERE user_id = auth.uid()
    )
  );
