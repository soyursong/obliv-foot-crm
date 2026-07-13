-- Faithful stub of the 4 tables the WS-A function touches (prod-accurate constraints).
DROP TABLE IF EXISTS status_transitions, check_ins, reservations, customers, clinics CASCADE;
CREATE TABLE clinics (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, name TEXT);
CREATE TABLE customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  visit_type TEXT DEFAULT 'new' CHECK (visit_type IN ('new','returning')),
  sms_opt_in BOOLEAN NOT NULL DEFAULT TRUE,
  birth_date TEXT,
  address TEXT,
  privacy_consent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX idx_customers_clinic_phone ON customers(clinic_id, phone);
CREATE TABLE reservations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  customer_id UUID REFERENCES customers(id),
  reservation_date DATE NOT NULL,
  reservation_time TIME NOT NULL DEFAULT '09:00',
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed','checked_in','cancelled','noshow')),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE check_ins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  customer_id UUID REFERENCES customers(id),
  reservation_id UUID REFERENCES reservations(id),
  queue_number INTEGER,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  visit_type TEXT NOT NULL DEFAULT 'new' CHECK (visit_type IN ('new','returning','experience')),
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN (
    'registered','checklist','exam_waiting','examination','consult_waiting','consultation',
    'payment_waiting','treatment_waiting','preconditioning','laser','done','cancelled')),
  notes JSONB,
  checked_in_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX unique_reservation_checkin ON check_ins (reservation_id)
  WHERE reservation_id IS NOT NULL AND status <> 'cancelled';
CREATE TABLE status_transitions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  check_in_id UUID NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  from_status TEXT NOT NULL, to_status TEXT NOT NULL,
  changed_by TEXT, transitioned_at TIMESTAMPTZ DEFAULT now()
);
