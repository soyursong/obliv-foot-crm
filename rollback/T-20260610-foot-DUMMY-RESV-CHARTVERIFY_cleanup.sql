-- T-20260610-foot-DUMMY-RESV-CHARTVERIFY — CLEANUP (rollback DELETE SQL)
-- 종로점(jongno-foot) 2026-06-10 더미 24건 일괄 삭제.
-- 실행 순서 엄수: reservations(FK child) 먼저 → customers(parent) 나중.
-- 마커: memo='[TEST-DUMMY 20260610]', is_simulation=true, phone prefix +82108810.

BEGIN;

-- 1) 예약 삭제
DELETE FROM reservations
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND reservation_date = '2026-06-10'
  AND memo = '[TEST-DUMMY 20260610]';

-- 2) 고객 삭제 (phone prefix + is_simulation 이중 가드)
DELETE FROM customers
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND is_simulation = true
  AND memo = '[TEST-DUMMY 20260610]'
  AND phone LIKE '+82108810%';

COMMIT;
