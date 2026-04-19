-- ============================================================
-- 오블리브 풋센터 CRM — Initial Schema
-- 2026-04-19
-- ============================================================

-- 1. clinics
CREATE TABLE clinics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  address TEXT,
  phone TEXT,
  open_time TIME DEFAULT '10:00',
  close_time TIME DEFAULT '22:00',
  weekend_close_time TIME DEFAULT '19:00',
  slot_interval INTEGER DEFAULT 30,
  consultation_rooms INTEGER DEFAULT 5,
  treatment_rooms INTEGER DEFAULT 9,
  laser_rooms INTEGER DEFAULT 12,
  exam_rooms INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. customers
CREATE TABLE customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  visit_type TEXT DEFAULT 'new' CHECK (visit_type IN ('new','returning')),
  memo TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX idx_customers_clinic_phone ON customers(clinic_id, phone);
CREATE INDEX idx_customers_phone ON customers(phone);

-- 3. services
CREATE TABLE services (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  discount_price INTEGER,
  duration_min INTEGER DEFAULT 30,
  vat_type TEXT DEFAULT 'none' CHECK (vat_type IN ('none','exclusive','inclusive')),
  service_type TEXT DEFAULT 'single' CHECK (service_type IN ('single','package_component','addon')),
  active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. staff
CREATE TABLE staff (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('director','consultant','coordinator','therapist','technician')),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. rooms
CREATE TABLE rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  name TEXT NOT NULL,
  room_type TEXT NOT NULL CHECK (room_type IN ('treatment','laser','consultation','examination')),
  active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0
);

-- 6. user_profiles
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  role TEXT DEFAULT 'staff' CHECK (role IN ('admin','manager','consultant','coordinator','therapist','technician','tm')),
  clinic_id UUID REFERENCES clinics(id),
  active BOOLEAN DEFAULT true,
  approved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. clinic_schedules
CREATE TABLE clinic_schedules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time TIME NOT NULL DEFAULT '10:00',
  close_time TIME NOT NULL DEFAULT '22:00',
  is_closed BOOLEAN DEFAULT false,
  UNIQUE(clinic_id, day_of_week)
);

-- 8. clinic_holidays
CREATE TABLE clinic_holidays (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  holiday_date DATE NOT NULL,
  memo TEXT
);

-- 9. reservations
CREATE TABLE reservations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  customer_id UUID REFERENCES customers(id),
  customer_name TEXT,
  customer_phone TEXT,
  reservation_date DATE NOT NULL,
  reservation_time TIME NOT NULL,
  visit_type TEXT DEFAULT 'returning' CHECK (visit_type IN ('new','returning','experience')),
  service_id UUID REFERENCES services(id),
  memo TEXT,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed','checked_in','cancelled','noshow')),
  referral_source TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_reservations_clinic_date ON reservations(clinic_id, reservation_date);

-- 10. check_ins
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
    'registered','checklist','exam_waiting','examination',
    'consult_waiting','consultation','payment_waiting',
    'treatment_waiting','preconditioning','laser',
    'done','cancelled'
  )),
  consultant_id UUID REFERENCES staff(id),
  therapist_id UUID REFERENCES staff(id),
  technician_id UUID REFERENCES staff(id),
  consultation_room TEXT,
  treatment_room TEXT,
  laser_room TEXT,
  notes JSONB,
  treatment_memo JSONB,
  treatment_photos TEXT[],
  checked_in_at TIMESTAMPTZ DEFAULT now(),
  called_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  priority_flag BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_check_ins_clinic_date ON check_ins(clinic_id, (checked_in_at::date));
CREATE INDEX idx_check_ins_status ON check_ins(clinic_id, status);

-- 11. check_in_services
CREATE TABLE check_in_services (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  check_in_id UUID NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id),
  service_name TEXT NOT NULL,
  price INTEGER DEFAULT 0,
  original_price INTEGER DEFAULT 0,
  is_package_session BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 12. packages
CREATE TABLE packages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  package_name TEXT NOT NULL,
  package_type TEXT NOT NULL,
  total_sessions INTEGER NOT NULL,
  heated_sessions INTEGER DEFAULT 0,
  unheated_sessions INTEGER DEFAULT 0,
  iv_sessions INTEGER DEFAULT 0,
  preconditioning_sessions INTEGER DEFAULT 0,
  shot_upgrade BOOLEAN DEFAULT false,
  af_upgrade BOOLEAN DEFAULT false,
  upgrade_surcharge INTEGER DEFAULT 0,
  total_amount INTEGER NOT NULL,
  paid_amount INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','cancelled','refunded','transferred')),
  transferred_from UUID REFERENCES packages(id),
  transferred_to UUID REFERENCES customers(id),
  expires_at DATE,
  contract_date DATE DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  memo TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_packages_customer ON packages(customer_id, status);

-- 13. package_sessions
CREATE TABLE package_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  check_in_id UUID REFERENCES check_ins(id),
  session_number INTEGER NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN (
    'heated_laser','unheated_laser','iv','preconditioning'
  )),
  session_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  unit_price INTEGER DEFAULT 0,
  surcharge INTEGER DEFAULT 0,
  surcharge_memo TEXT,
  status TEXT DEFAULT 'used' CHECK (status IN ('used','cancelled','refunded')),
  performed_by UUID REFERENCES staff(id),
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(package_id, session_number)
);
CREATE INDEX idx_package_sessions_package ON package_sessions(package_id, status);

-- add FK from check_in_services to package_sessions
ALTER TABLE check_in_services ADD COLUMN package_session_id UUID REFERENCES package_sessions(id);

-- add FK from check_ins to packages
ALTER TABLE check_ins ADD COLUMN package_id UUID REFERENCES packages(id);

-- 14. package_payments
CREATE TABLE package_payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  amount INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('card','cash','transfer')),
  installment INTEGER DEFAULT 0,
  payment_type TEXT DEFAULT 'payment' CHECK (payment_type IN ('payment','refund')),
  vat_amount INTEGER DEFAULT 0,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_package_payments_package ON package_payments(package_id);

-- 15. payments (단건)
CREATE TABLE payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  check_in_id UUID REFERENCES check_ins(id),
  customer_id UUID REFERENCES customers(id),
  amount INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('card','cash','transfer','membership')),
  installment INTEGER DEFAULT 0,
  payment_type TEXT DEFAULT 'payment' CHECK (payment_type IN ('payment','refund')),
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_payments_check_in ON payments(check_in_id);

-- 16. consent_forms
CREATE TABLE consent_forms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  check_in_id UUID REFERENCES check_ins(id),
  form_type TEXT NOT NULL CHECK (form_type IN ('refund','non_covered','treatment','privacy')),
  form_data JSONB NOT NULL,
  signature_url TEXT,
  signed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_consent_forms_customer ON consent_forms(customer_id);

-- 17. checklists
CREATE TABLE checklists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  check_in_id UUID REFERENCES check_ins(id),
  checklist_data JSONB NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 18. insurance_documents
CREATE TABLE insurance_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  check_in_id UUID REFERENCES check_ins(id),
  document_type TEXT NOT NULL CHECK (document_type IN ('receipt','detail','opinion','koh')),
  document_data JSONB NOT NULL,
  issued_at TIMESTAMPTZ DEFAULT now(),
  issued_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 19. status_transitions
CREATE TABLE status_transitions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  check_in_id UUID NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  room_id TEXT,
  changed_by TEXT,
  transitioned_at TIMESTAMPTZ DEFAULT now()
);

-- 20. room_assignments
CREATE TABLE room_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  date DATE NOT NULL,
  room_name TEXT NOT NULL,
  room_type TEXT NOT NULL CHECK (room_type IN ('treatment','laser','consultation','examination')),
  staff_id UUID REFERENCES staff(id),
  staff_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(clinic_id, date, room_name)
);

-- 21. daily_closings
CREATE TABLE daily_closings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  close_date DATE NOT NULL,
  package_card_total INTEGER DEFAULT 0,
  package_cash_total INTEGER DEFAULT 0,
  package_transfer_total INTEGER DEFAULT 0,
  single_card_total INTEGER DEFAULT 0,
  single_cash_total INTEGER DEFAULT 0,
  single_transfer_total INTEGER DEFAULT 0,
  actual_card_total INTEGER DEFAULT 0,
  actual_cash_total INTEGER DEFAULT 0,
  difference INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at TIMESTAMPTZ,
  memo TEXT,
  UNIQUE(clinic_id, close_date)
);

-- 22. notifications
CREATE TABLE notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  check_in_id UUID REFERENCES check_ins(id),
  type TEXT,
  template TEXT,
  message TEXT,
  status TEXT DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- RPC Functions
-- ============================================================

-- 대기번호 자동생성
CREATE OR REPLACE FUNCTION next_queue_number(p_clinic_id UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COALESCE(MAX(queue_number), 0) + 1
  FROM check_ins
  WHERE clinic_id = p_clinic_id
    AND checked_in_at::date = (now() AT TIME ZONE 'Asia/Seoul')::date;
$$;

-- 패키지 잔여 회차 조회
CREATE OR REPLACE FUNCTION get_package_remaining(p_package_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'heated', p.heated_sessions - COALESCE(SUM(CASE WHEN ps.session_type = 'heated_laser' AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'unheated', p.unheated_sessions - COALESCE(SUM(CASE WHEN ps.session_type = 'unheated_laser' AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'iv', p.iv_sessions - COALESCE(SUM(CASE WHEN ps.session_type = 'iv' AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'preconditioning', p.preconditioning_sessions - COALESCE(SUM(CASE WHEN ps.session_type = 'preconditioning' AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'total_used', COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0),
    'total_remaining', p.total_sessions - COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0)
  )
  FROM packages p
  LEFT JOIN package_sessions ps ON ps.package_id = p.id
  WHERE p.id = p_package_id
  GROUP BY p.id, p.heated_sessions, p.unheated_sessions, p.iv_sessions, p.preconditioning_sessions, p.total_sessions;
$$;

-- 고객 활성 패키지 목록
CREATE OR REPLACE FUNCTION get_customer_packages(p_customer_id UUID)
RETURNS SETOF JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'package_name', p.package_name,
    'package_type', p.package_type,
    'status', p.status,
    'total_sessions', p.total_sessions,
    'total_amount', p.total_amount,
    'paid_amount', p.paid_amount,
    'contract_date', p.contract_date,
    'remaining', get_package_remaining(p.id)
  )
  FROM packages p
  WHERE p.customer_id = p_customer_id
    AND p.status = 'active'
  ORDER BY p.contract_date DESC;
$$;

-- 환불 금액 계산
CREATE OR REPLACE FUNCTION calc_refund_amount(p_package_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'total_amount', p.total_amount,
    'total_sessions', p.total_sessions,
    'used_sessions', COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0),
    'remaining_sessions', p.total_sessions - COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0),
    'unit_price', CASE WHEN p.total_sessions > 0 THEN p.total_amount / p.total_sessions ELSE 0 END,
    'refund_amount', CASE WHEN p.total_sessions > 0
      THEN (p.total_amount / p.total_sessions) * (p.total_sessions - COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0))
      ELSE 0 END
  )
  FROM packages p
  LEFT JOIN package_sessions ps ON ps.package_id = p.id
  WHERE p.id = p_package_id
  GROUP BY p.id, p.total_amount, p.total_sessions;
$$;

-- 고객 전화번호 검색
CREATE OR REPLACE FUNCTION find_customer_by_phone(p_phone TEXT, p_clinic_id UUID DEFAULT NULL)
RETURNS SETOF customers
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM customers
  WHERE phone = p_phone
    AND (p_clinic_id IS NULL OR clinic_id = p_clinic_id)
  ORDER BY updated_at DESC;
$$;
