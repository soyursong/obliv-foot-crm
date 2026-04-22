-- P0-2: Add clinic_id to payments and package_payments tables
ALTER TABLE payments ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id);
ALTER TABLE package_payments ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id);

CREATE INDEX IF NOT EXISTS idx_payments_clinic_date ON payments(clinic_id, created_at);
CREATE INDEX IF NOT EXISTS idx_package_payments_clinic_date ON package_payments(clinic_id, created_at);
