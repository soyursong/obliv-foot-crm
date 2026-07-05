-- Minimal stub schema: only columns referenced by the two stat functions.
CREATE TABLE staff (id uuid PRIMARY KEY, name text, clinic_id uuid, role text, active boolean);
CREATE TABLE customers (id uuid PRIMARY KEY, clinic_id uuid, designated_therapist_id uuid);
CREATE TABLE packages (id uuid PRIMARY KEY, customer_id uuid, clinic_id uuid, contract_date date);
CREATE TABLE package_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), package_id uuid, performed_by uuid, session_date date, status text, session_type text, check_in_id uuid, unit_price int, surcharge int);
CREATE TABLE package_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), package_id uuid, payment_type text);
CREATE TABLE check_ins (id uuid PRIMARY KEY, therapist_id uuid, customer_id uuid, visit_type text, package_id uuid, checked_in_at timestamptz, clinic_id uuid, status text);
CREATE TABLE status_transitions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), check_in_id uuid, transitioned_at timestamptz, to_status text, from_status text);
CREATE TABLE payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid, check_in_id uuid, created_at timestamptz, payment_type text, amount int);
CREATE TABLE check_in_services (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), check_in_id uuid, service_id uuid);
CREATE TABLE services (id uuid PRIMARY KEY, category text);
CREATE ROLE authenticated;
