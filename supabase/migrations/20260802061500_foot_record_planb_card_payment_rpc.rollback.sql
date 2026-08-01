-- ROLLBACK — T-20260730-foot-REDPAY-PLANB-GOLIVE-0805-SCHEDULE-LOCK single RPC
--   ADDITIVE(CREATE FUNCTION)의 역연산 = DROP FUNCTION. 기존 스키마 무접촉이므로 회귀 0(구조적).
DROP FUNCTION IF EXISTS public.record_planb_card_payment(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,timestamptz);
