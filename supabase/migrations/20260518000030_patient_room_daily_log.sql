-- T-20260516-foot-ROOM-MOVE-TRACK: 환자 일일 동선 기록 (last-room-wins UPSERT)
-- 4개 슬롯 유형만 추적: 상담실 / 치료실 / 가열성레이저 / 레이저실
-- 같은 슬롯 유형 내 이동 시 마지막 실번호로 UPSERT (한 환자·하루·슬롯유형 = 1행)
-- Rollback: 20260518000030_patient_room_daily_log.down.sql

BEGIN;

-- ── 1. patient_room_daily_log 테이블 ──────────────────────────────────────────
CREATE TABLE patient_room_daily_log (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  date            date        NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date,
  slot_type       text        NOT NULL CHECK (slot_type IN ('상담실', '치료실', '가열성레이저', '레이저실')),
  room_number     text        NOT NULL,   -- 자유 텍스트 (C3, L7, 상담실4, 가열성레이저 등)
  last_moved_at   timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  clinic_id       uuid        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  UNIQUE (patient_id, date, slot_type, clinic_id)  -- last-room-wins UPSERT 키
);

CREATE INDEX idx_patient_room_daily_log_patient_date
  ON patient_room_daily_log(patient_id, date);

-- RLS
ALTER TABLE patient_room_daily_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patient_room_daily_log_clinic_access" ON patient_room_daily_log
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.clinic_id = patient_room_daily_log.clinic_id
        AND user_profiles.active = true
        AND user_profiles.approved = true
    )
  );

-- ── 2. check_in_room_logs room_type CHECK에 heated_laser 추가 (가열성레이저 지원) ──
ALTER TABLE check_in_room_logs
  DROP CONSTRAINT IF EXISTS check_in_room_logs_room_type_check;

ALTER TABLE check_in_room_logs
  ADD CONSTRAINT check_in_room_logs_room_type_check
  CHECK (room_type IN ('examination', 'consultation', 'treatment', 'laser', 'heated_laser'));

COMMENT ON TABLE patient_room_daily_log IS
  '환자 일일 동선 기록. 슬롯 유형별 마지막 배정 실번호만 유지 (last-room-wins UPSERT). T-20260516-foot-ROOM-MOVE-TRACK';

COMMIT;
