CREATE TABLE IF NOT EXISTS reservation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  action TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  changed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reservation_logs_reservation ON reservation_logs(reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservation_logs_clinic_date ON reservation_logs(clinic_id, created_at);
