-- ROLLBACK — T-20260806-dopamine-COMPANION-CHECKIN-FOOT-JONGNO-FIX (promote RPC)
-- 신규 함수 DROP. 데이터 무접촉(함수는 상태 없음). 이미 승격된 reservation.customer_id/companion_of 는 유지(무해).
DROP FUNCTION IF EXISTS public.fn_staff_companion_promote(uuid, text, text, text);
