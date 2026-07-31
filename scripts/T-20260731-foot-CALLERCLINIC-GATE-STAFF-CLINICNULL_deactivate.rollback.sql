-- ============================================================================
-- T-20260731-foot-CALLERCLINIC-GATE-STAFF-CLINICNULL — ROLLBACK (재활성화)
--   apply.sql 로 비활성화한 이승준 코디 계정을 원상(active=true)으로 완전가역 복원.
--
--   before 상태(스냅샷 기준): active=true, approved=false, clinic_id=NULL (기타 컬럼 무변경)
--   → apply 는 active 만 true→false 로 바꿨으므로, 이 UPDATE 로 100% 원상복원된다.
--   (approved/role/clinic_id/name/email/created_at 은 apply 가 건드리지 않았음 = 복원 불요.)
-- ============================================================================

BEGIN;

UPDATE public.user_profiles
   SET active = true
 WHERE id = '68c50c25-8725-4e96-8a52-c47dde03a786'
   AND lower(email) = lower('sj.lee0719@medibuilder.com')
   AND active = false;

DO $post$
DECLARE v_active boolean;
BEGIN
  SELECT active INTO v_active
    FROM public.user_profiles
   WHERE id = '68c50c25-8725-4e96-8a52-c47dde03a786';
  RAISE NOTICE 'ROLLBACK: user_profiles(68c50c25...) active=% (원상 true 기대)', v_active;
END $post$;

COMMIT;
