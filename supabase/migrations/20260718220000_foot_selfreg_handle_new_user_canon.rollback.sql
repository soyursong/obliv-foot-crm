-- T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX 롤백
-- ⚠ women 형제와 다름: foot 은 handle_new_user 함수+트리거가 **pre-exist**(벤더잔차)였다.
--    ∴ 롤백 = DROP 이 아니라 canon 재정의 직전의 BEFORE 벤더잔차 정의로 CREATE OR REPLACE **복원**.
--    (BEFORE prod introspection 실측본, 2026-07-18T21:00 KST · db-gate evidence 참조.)
--    · 롤백은 장애 회귀 대응 한정. 복원되는 정의는 알려진 약점(최초유저 admin+approved 자동승격,
--      search_path=public, PUBLIC EXECUTE)을 그대로 되돌린다 = last-known-state 복귀 시맨틱.
--    · user_profiles 데이터·RLS 정책(0515)·anon grant 무영향(정의만 교체).
-- 2026-07-18

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_count int;
  v_default_clinic_id uuid;
BEGIN
  -- Count existing user_profiles to determine if this is the first user
  SELECT count(*) INTO v_user_count FROM public.user_profiles;

  -- Pick the first clinic as the default for the first admin
  IF v_user_count = 0 THEN
    SELECT id INTO v_default_clinic_id FROM public.clinics ORDER BY created_at ASC LIMIT 1;
  END IF;

  INSERT INTO public.user_profiles (id, email, name, approved, active, role, clinic_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    CASE WHEN v_user_count = 0 THEN true ELSE false END,
    true,
    CASE WHEN v_user_count = 0 THEN 'admin' ELSE 'coordinator' END,
    v_default_clinic_id
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- 트리거 배선 재확인(복원)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- canon COMMENT 제거(BEFORE 는 COMMENT 없음)
COMMENT ON FUNCTION public.handle_new_user() IS NULL;
