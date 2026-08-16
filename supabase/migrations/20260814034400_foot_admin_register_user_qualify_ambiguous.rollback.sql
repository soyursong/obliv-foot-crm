-- ROLLBACK: admin_register_user qualify fix 되돌림 = foot prod live 현 body 복원
--   (md5(prosrc)=22f7ee6978c7b9ee71d31c4bf61f2572 기준 = 20260513000070_admin_register_user_part_lead.sql body)
--   좌변 name/role unqualified 상태로 복귀(선재 잠복결함 재노출) — 롤백 전용, 정상 운영에서는 up 유지.
--   ★시그니처·GRANT 동일 유지.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_register_user(
  target_user_id UUID,
  email TEXT,
  name TEXT,
  role TEXT,
  approved BOOLEAN DEFAULT true,
  staff_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clinic UUID;
  v_existing_staff_id UUID;
  v_new_staff_id UUID;
  v_staff_role TEXT;
  v_clinical BOOLEAN;
BEGIN
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only' USING ERRCODE = '42501';
  END IF;

  v_clinic := public.current_user_clinic_id();
  IF v_clinic IS NULL THEN
    RAISE EXCEPTION 'caller has no clinic_id' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'auth.users(%) not found — 중복 이메일 또는 signUp 미완료. identities 배열을 확인하세요', target_user_id USING ERRCODE = '23503';
  END IF;

  IF role NOT IN ('admin','manager','director','part_lead','consultant','coordinator','therapist','technician','tm','staff') THEN
    RAISE EXCEPTION 'invalid role: %', role USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_profiles (id, email, name, role, clinic_id, approved, active)
  VALUES (target_user_id, lower(email), name, role, v_clinic, approved, true)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    clinic_id = EXCLUDED.clinic_id,
    approved = EXCLUDED.approved,
    active = true;

  v_clinical := role IN ('consultant','coordinator','therapist','technician');

  IF v_clinical THEN
    v_staff_role := role;

    IF staff_id IS NOT NULL THEN
      SELECT id INTO v_existing_staff_id
      FROM public.staff
      WHERE id = staff_id
        AND clinic_id = v_clinic
        AND (user_id IS NULL OR user_id = target_user_id);

      IF v_existing_staff_id IS NULL THEN
        RAISE EXCEPTION 'staff(%) not found in clinic or already linked to other user', staff_id USING ERRCODE = '23503';
      END IF;

      UPDATE public.staff
      SET user_id = target_user_id,
          active = true
      WHERE id = v_existing_staff_id;

      v_new_staff_id := v_existing_staff_id;
    ELSE
      SELECT id INTO v_existing_staff_id
      FROM public.staff
      WHERE clinic_id = v_clinic
        AND name = admin_register_user.name
        AND role = v_staff_role
        AND user_id IS NULL
      LIMIT 1;

      IF v_existing_staff_id IS NOT NULL THEN
        UPDATE public.staff
        SET user_id = target_user_id,
            active = true
        WHERE id = v_existing_staff_id;
        v_new_staff_id := v_existing_staff_id;
      ELSE
        INSERT INTO public.staff (clinic_id, name, role, active, user_id)
        VALUES (v_clinic, admin_register_user.name, v_staff_role, true, target_user_id)
        RETURNING id INTO v_new_staff_id;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'user_id', target_user_id,
    'staff_id', v_new_staff_id,
    'clinical', v_clinical,
    'clinic_id', v_clinic
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_register_user(UUID, TEXT, TEXT, TEXT, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_register_user(UUID, TEXT, TEXT, TEXT, BOOLEAN, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
