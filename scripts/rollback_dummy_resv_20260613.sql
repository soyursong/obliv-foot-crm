-- T-20260613-foot-DUMMY-CHARTFIX — cleanup/rollback SQL
-- 종로점(jongno-foot, clinic_id 74967aea) 2026-06-13 표준 더미 26건(재생성분) 전부 되돌림.
-- 순서: reservations → customers (FK 참조 역순).
-- 키: memo 마커 '[TEST-DUMMY 20260613]' + phone prefix '+82108813' + clinic_id + date.
-- ⚠ 실데이터 4건(memo NULL, customer_id SET)은 마커 불일치로 영향 없음.

BEGIN;

DELETE FROM reservations
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND reservation_date = '2026-06-13'
   AND memo = '[TEST-DUMMY 20260613]';

DELETE FROM customers
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND memo = '[TEST-DUMMY 20260613]'
   AND phone LIKE '+82108813%';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- 참고: 본 티켓 cleanup으로 이미 제거된 "결함더미"(이중생성 52건, customer_id NULL)
-- 의 원복 키는 아래와 같았음(이미 DELETE 완료, 기록용). 6/13 날짜 한정 필수
-- ("테스트 더미"는 6/08에도 76건 존재 → 날짜 범위 미한정 시 6/08 더미 오삭제 위험).
--   DELETE FROM reservations
--    WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
--      AND reservation_date = '2026-06-13'
--      AND memo IN ('테스트 더미', '[테스트더미]');
--   (결함더미 52건은 customer_id NULL 전량 → 연결 customers 없음, customers DELETE 불요)
