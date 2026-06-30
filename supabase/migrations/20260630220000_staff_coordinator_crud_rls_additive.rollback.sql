-- ROLLBACK: T-20260630-foot-STAFFCRUD-CODY-PERM
-- 본 마이그는 ADDITIVE(신규 coordinator 정책 2종만 추가, 기존 정책 무변경) → 신규 정책 DROP 만으로 완전 원복.
BEGIN;
DROP POLICY IF EXISTS staff_coordinator_insert_staffcrud ON public.staff;
DROP POLICY IF EXISTS staff_coordinator_update_staffcrud ON public.staff;
COMMIT;
