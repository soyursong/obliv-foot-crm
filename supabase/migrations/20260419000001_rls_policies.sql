-- ============================================================
-- RLS Policies
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_in_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Authenticated users: full access (v1 simplification)
CREATE POLICY "auth_all" ON clinics FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON customers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON services FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON staff FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON rooms FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON user_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON clinic_schedules FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON clinic_holidays FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON reservations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON check_ins FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON check_in_services FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON packages FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON package_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON package_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON consent_forms FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON checklists FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON insurance_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON status_transitions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON room_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON daily_closings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anon: self check-in access
CREATE POLICY "anon_clinic_read" ON clinics FOR SELECT TO anon USING (true);
CREATE POLICY "anon_customer_read" ON customers FOR SELECT TO anon USING (true);
CREATE POLICY "anon_customer_create" ON customers FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_reservation_read" ON reservations FOR SELECT TO anon USING (true);
CREATE POLICY "anon_checkin_create" ON check_ins FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_checkin_read" ON check_ins FOR SELECT TO anon USING (true);
CREATE POLICY "anon_checklist_create" ON checklists FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_service_read" ON services FOR SELECT TO anon USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE check_ins;
ALTER PUBLICATION supabase_realtime ADD TABLE reservations;
ALTER PUBLICATION supabase_realtime ADD TABLE room_assignments;
