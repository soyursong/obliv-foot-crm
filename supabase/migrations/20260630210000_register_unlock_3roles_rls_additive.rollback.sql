-- ROLLBACK: T-20260630-foot-REGISTER-MENU-CODY-UNLOCK RLS ADDITIVE (3역할 신규등록 write)
--   ADDITIVE 신규 정책만 추가했으므로 롤백 = 그 정책 DROP (기존 정책은 무변경이라 복원 불요).
--   clinic isolation·기존 admin/manager/director/coordinator write 동선 영향 0.

BEGIN;

DROP POLICY IF EXISTS "customers_register_unlock_insert" ON public.customers;
DROP POLICY IF EXISTS "reservations_register_unlock_insert" ON public.reservations;
DROP POLICY IF EXISTS "check_ins_register_unlock_insert" ON public.check_ins;

COMMIT;
