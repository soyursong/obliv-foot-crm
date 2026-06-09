-- T-20260609-foot-DUMMY-RESV-JONGNO — CLEANUP (테스트 종료 후 더미 30건 일괄 삭제)
-- 종로점(jongno-foot, clinic_id 74967aea-a60b-4da3-a0e7-9c997a930bc8) 2026-06-09 더미 예약/고객.
-- 식별 마커: memo='[TEST-DUMMY 20260609]', customers.is_simulation=true, phone prefix '+82108809'.
-- 실행 순서: reservations 먼저(FK customer_id → customers), customers 나중.

BEGIN;

-- 1) 더미 예약 30건 삭제
DELETE FROM reservations
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND reservation_date = '2026-06-09'
  AND memo = '[TEST-DUMMY 20260609]';

-- 2) 더미 고객 30건 삭제
DELETE FROM customers
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND is_simulation = true
  AND memo = '[TEST-DUMMY 20260609]'
  AND phone LIKE '+82108809%';

-- 삭제 건수 확인 후 COMMIT (롤백 가능). 검증: 각 30건이어야 함.
COMMIT;

-- (검증 쿼리)
-- SELECT count(*) FROM reservations WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8' AND reservation_date='2026-06-09' AND memo='[TEST-DUMMY 20260609]'; -- 0 기대
-- SELECT count(*) FROM customers   WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8' AND is_simulation=true AND memo='[TEST-DUMMY 20260609]'; -- 0 기대
