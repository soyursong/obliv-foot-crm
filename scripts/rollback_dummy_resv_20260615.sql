-- T-20260615-foot-DUMMY-RESV-CHARTOPEN-VERIFY — cleanup/rollback SQL
-- 종로점(jongno-foot, clinic_id 74967aea) 2026-06-15 더미 32건(초진16+재진16) 전부 되돌림.
-- 순서: reservations → customers (FK 참조 역순).
-- 키: created_by='TEST-20260615' (티켓 의무 롤백 기준) + date + phone prefix '+82108615'.
-- ⚠ 실데이터(created_by 마커 불일치)는 영향 없음. INSERT only 작업의 정확한 역연산.

BEGIN;

DELETE FROM reservations
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND created_by = 'TEST-20260615'
   AND reservation_date = '2026-06-15';

DELETE FROM customers
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND created_by = 'TEST-20260615'
   AND phone LIKE '+82108615%';

COMMIT;
