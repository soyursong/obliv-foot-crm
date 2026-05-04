-- duty_roster — 당일 근무원장님 관리
-- T-20260502-foot-DUTY-ROSTER
-- 서류 발행 시 당일 근무 원장님 자동 세팅 + 이중 검증 프로세스

CREATE TABLE IF NOT EXISTS duty_roster (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  date        DATE        NOT NULL,
  doctor_id   UUID        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  roster_type TEXT        NOT NULL DEFAULT 'regular'
                          CHECK (roster_type IN ('regular', 'part', 'resigned')),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (clinic_id, date, doctor_id)
);

CREATE INDEX IF NOT EXISTS duty_roster_clinic_date_idx
  ON duty_roster(clinic_id, date);

-- RLS 활성화
ALTER TABLE duty_roster ENABLE ROW LEVEL SECURITY;

-- 같은 클리닉 활성 계정: 읽기
CREATE POLICY "duty_roster_select" ON duty_roster
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = duty_roster.clinic_id
        AND active    = true
        AND approved  = true
    )
  );

-- admin/manager: INSERT
CREATE POLICY "duty_roster_insert" ON duty_roster
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = duty_roster.clinic_id
        AND active    = true
        AND approved  = true
        AND role      IN ('admin', 'manager')
    )
  );

-- admin/manager: UPDATE
CREATE POLICY "duty_roster_update" ON duty_roster
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = duty_roster.clinic_id
        AND active    = true
        AND approved  = true
        AND role      IN ('admin', 'manager')
    )
  );

-- admin/manager: DELETE
CREATE POLICY "duty_roster_delete" ON duty_roster
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = duty_roster.clinic_id
        AND active    = true
        AND approved  = true
        AND role      IN ('admin', 'manager')
    )
  );
