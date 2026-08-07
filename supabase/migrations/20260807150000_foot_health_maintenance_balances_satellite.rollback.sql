-- ROLLBACK: 20260807150000_foot_health_maintenance_balances_satellite.sql
-- T-20260807-foot-MEDAID1-HEALTHFEE-BALANCE-NOTPERSISTED
-- ADDITIVE 역: net-new 테이블 + 트리거 + 트리거함수만 제거(대칭). 기존 테이블 무접촉.
--   satellite 는 스냅샷만 보유(원장 아님) → DROP 해도 payments/customers 원장 무손상,
--   현재잔액 파생 소스(payments)도 무접촉. FE 는 satellite 부재 시 잔액 0 폴백(회귀 안전).

BEGIN;

DROP TRIGGER IF EXISTS trg_health_maintenance_balances_touch ON public.health_maintenance_balances;
DROP FUNCTION IF EXISTS public.tg_health_maintenance_balances_touch();
DROP TABLE IF EXISTS public.health_maintenance_balances;

COMMIT;
