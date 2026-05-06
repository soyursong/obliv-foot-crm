-- ============================================================
-- T-20260507-foot-DELETE-TEST-CUSTOMERS
-- 풋센터 CRM 테스트 고객 데이터 전체 삭제
-- clinic_id: 74967aea-a60b-4da3-a0e7-9c997a930bc8
-- 생성일: 2026-05-07
-- 백업: backup_test_customers_20260507/ (JSON 파일)
-- 롤백 SQL: rollback_test_customers.sql
-- ============================================================
-- 실행 전 확인:
--   SELECT COUNT(*) FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
--   → 308건 예상
-- ============================================================

BEGIN;

-- ===== STEP 0: 자기참조 FK 해제 =====
-- customers.referrer_id → customers.id (self-ref)
UPDATE customers
SET referrer_id = NULL
WHERE referrer_id IN (
    SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
);

-- packages.transferred_from → packages.id (self-ref)
UPDATE packages
SET transferred_from = NULL
WHERE customer_id IN (
    SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
);

-- ===== STEP 1: check_ins 자식 테이블 삭제 =====
-- (status_transitions, notifications, check_in_services,
--  payments, payment_code_claims, service_charges, prescriptions,
--  insurance_receipts, insurance_documents, form_submissions,
--  consent_forms, checklists)

DELETE FROM status_transitions
WHERE check_in_id IN (
    SELECT id FROM check_ins
    WHERE customer_id IN (
        SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
    )
);

DELETE FROM notifications
WHERE check_in_id IN (
    SELECT id FROM check_ins
    WHERE customer_id IN (
        SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
    )
);

DELETE FROM check_in_services
WHERE check_in_id IN (
    SELECT id FROM check_ins
    WHERE customer_id IN (
        SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
    )
);

DELETE FROM payments
WHERE customer_id IN (
    SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
);

DELETE FROM payment_code_claims
WHERE customer_id IN (
    SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
);

DELETE FROM service_charges
WHERE customer_id IN (
    SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
);

DELETE FROM prescriptions
WHERE customer_id IN (
    SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
);

DELETE FROM insurance_receipts
WHERE customer_id IN (
    SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
);

DELETE FROM insurance_documents
WHERE customer_id IN (
    SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
);

DELETE FROM form_submissions
WHERE customer_id IN (
    SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
);

DELETE FROM consent_forms
WHERE customer_id IN (
    SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
);

DELETE FROM checklists
WHERE customer_id IN (
    SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
);

-- ===== STEP 2: packages 자식 테이블 삭제 =====
DELETE FROM package_payments
WHERE package_id IN (
    SELECT id FROM packages
    WHERE customer_id IN (
        SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
    )
);

DELETE FROM package_sessions
WHERE package_id IN (
    SELECT id FROM packages
    WHERE customer_id IN (
        SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
    )
);

-- ===== STEP 3: reservation_logs 삭제 =====
DELETE FROM reservation_logs
WHERE reservation_id IN (
    SELECT id FROM reservations
    WHERE customer_id IN (
        SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
    )
);

-- ===== STEP 4: check_ins 삭제 =====
DELETE FROM check_ins
WHERE customer_id IN (
    SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
);

-- ===== STEP 5: reservations 삭제 =====
DELETE FROM reservations
WHERE customer_id IN (
    SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
);

-- ===== STEP 6: packages 삭제 =====
DELETE FROM packages
WHERE customer_id IN (
    SELECT id FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
);

-- ===== STEP 7: customers 삭제 =====
DELETE FROM customers
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

COMMIT;

-- ===== 검증 쿼리 =====
SELECT 'customers' AS tbl, COUNT(*) AS remaining FROM customers WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
UNION ALL SELECT 'reservations', COUNT(*) FROM reservations r JOIN customers c ON r.customer_id = c.id WHERE c.clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
UNION ALL SELECT 'check_ins', COUNT(*) FROM check_ins ci JOIN customers c ON ci.customer_id = c.id WHERE c.clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
UNION ALL SELECT 'packages', COUNT(*) FROM packages p JOIN customers c ON p.customer_id = c.id WHERE c.clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
