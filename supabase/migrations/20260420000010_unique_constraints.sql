-- #21: Prevent duplicate session deduction per check-in
ALTER TABLE package_sessions
  ADD CONSTRAINT unique_package_checkin UNIQUE (package_id, check_in_id);

-- #22: Prevent duplicate check-in per reservation
CREATE UNIQUE INDEX IF NOT EXISTS unique_reservation_checkin
  ON check_ins (reservation_id) WHERE reservation_id IS NOT NULL;
