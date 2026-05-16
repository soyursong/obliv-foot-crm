-- T-20260515-foot-RESV-MEMO-APPEND
-- 예약메모 누적 저장 테이블 생성 (append-only)
-- GO_WARN: 신규 테이블 + 기존 데이터 마이그레이션

CREATE TABLE IF NOT EXISTS reservation_memo_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  clinic_id    uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  content      text NOT NULL,
  created_by   uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_by_name text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rmh_reservation_id ON reservation_memo_history(reservation_id);
CREATE INDEX IF NOT EXISTS idx_rmh_clinic_id ON reservation_memo_history(clinic_id);

-- RLS: clinic_id 기준 격리
ALTER TABLE reservation_memo_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic_isolation_rmh" ON reservation_memo_history
  USING (clinic_id = (SELECT clinic_id FROM staff WHERE id = auth.uid()));

-- 기존 reservations.booking_memo 마이그레이션 (non-null인 것만)
INSERT INTO reservation_memo_history (reservation_id, clinic_id, content, created_at)
SELECT
  r.id,
  r.clinic_id,
  r.booking_memo,
  COALESCE(r.updated_at, r.created_at)
FROM reservations r
WHERE r.booking_memo IS NOT NULL
  AND r.booking_memo <> ''
ON CONFLICT DO NOTHING;

COMMENT ON TABLE reservation_memo_history IS '예약메모 누적 이력 (append-only)';
