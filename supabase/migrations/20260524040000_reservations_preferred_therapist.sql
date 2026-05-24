-- T-20260524-foot-THERAPIST-BISYNC: 재진 예약 ↔ 지정 치료사 쌍방 동기화
-- reservations.preferred_therapist_id 컬럼 추가
-- customers.designated_therapist_id는 20260522070000_designated_therapist.sql에서 이미 추가됨
-- BL: 수기 입력 어느 쪽이든 양방향 자동 연동 (빈 필드만, 덮어쓰기 X)

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS preferred_therapist_id UUID REFERENCES staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_preferred_therapist
  ON reservations(preferred_therapist_id)
  WHERE preferred_therapist_id IS NOT NULL;

COMMENT ON COLUMN reservations.preferred_therapist_id IS
  'T-20260524-foot-THERAPIST-BISYNC: 재진 예약 지정 치료사 — customers.designated_therapist_id와 쌍방 동기화. 수기 입력 시 양방향 자동 반영.';
