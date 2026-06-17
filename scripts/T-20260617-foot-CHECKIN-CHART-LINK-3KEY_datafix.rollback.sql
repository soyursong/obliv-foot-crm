-- ROLLBACK: T-20260617-foot-CHECKIN-CHART-LINK-3KEY AC-4 데이터 정정
-- check_in 4b091fa7 의 customer_id 를 정정 전(오배정) 값으로 되돌린다.
-- guard: 현재값이 정정 값(김사비)일 때만.

BEGIN;

UPDATE check_ins
   SET customer_id = '8ba2bbef-018e-4207-b2ab-196e18322437'  -- 문자테스트 / F-1189 (정정 전 값)
 WHERE id = '4b091fa7-29c9-48c8-854b-42b53905351b'
   AND customer_id = '2be865ff-6a9d-4666-892c-1cfd2d971199';

COMMIT;
