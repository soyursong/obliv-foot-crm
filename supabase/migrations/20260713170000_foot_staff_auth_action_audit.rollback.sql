-- ROLLBACK: T-20260713-foot-AUTH-ACTOR-AUDIT-APPLEVEL
-- =============================================================================
-- 되돌림:
--   (a) 3종 destructive RPC 를 audit stamp 삽입 前 원본 body 로 복원
--       (admin_reset_user_password = 20260517000020 fix 상태 / register·toggle = 20260425220744 상태)
--   (b) log_staff_auth_action 헬퍼 DROP
--   (c) staff_auth_action_audit 테이블 DROP (감사 데이터 소실 주의 — 아래 註)
-- 순서: RPC 복원 먼저(헬퍼 참조 제거) → 헬퍼 DROP → 테이블 DROP.
-- 註(데이터 보존): 이미 적재된 감사행을 보존하려면 (c) 대신 테이블 유지 + RPC/헬퍼만 되돌리면 됨.
--    파괴적 완전 롤백이 필요할 때만 (c) 실행. 감사 무결성상 (c)는 신중히.
-- =============================================================================

BEGIN;

-- (a-1) admin_reset_user_password → 20260517000020 상태 복원
CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
  target_user_id UUID,
  new_password TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only' USING ERRCODE = '42501';
  END IF;

  IF new_password IS NULL OR length(new_password) < 6 THEN
    RAISE EXCEPTION 'password too short (min 6)' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'auth.users(%) not found', target_user_id USING ERRCODE = '23503';
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(new_password, gen_salt('bf')),
      updated_at = now()
  WHERE id = target_user_id;

  RETURN jsonb_build_object('user_id', target_user_id, 'reset_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reset_user_password(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(UUID, TEXT) TO authenticated;

-- (a-2) admin_toggle_user_active → 20260425220744 상태 복원
CREATE OR REPLACE FUNCTION public.admin_toggle_user_active(
  target_user_id UUID,
  set_active BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_count INT := 0;
BEGIN
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'user_profiles(%) not found', target_user_id USING ERRCODE = '23503';
  END IF;

  UPDATE public.user_profiles
  SET active = set_active
  WHERE id = target_user_id;

  UPDATE public.staff
  SET active = set_active
  WHERE user_id = target_user_id;

  GET DIAGNOSTICS v_staff_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'user_id', target_user_id,
    'active', set_active,
    'staff_synced', v_staff_count
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_toggle_user_active(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_toggle_user_active(UUID, BOOLEAN) TO authenticated;

-- (a-3) admin_register_user → 20260425220744 상태 복원
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
    RAISE EXCEPTION 'auth.users(% ) not found — call signUp first', target_user_id USING ERRCODE = '23503';
  END IF;

  IF role NOT IN ('admin','manager','consultant','coordinator','therapist','technician','tm','staff') THEN
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

-- (b) 헬퍼 DROP
DROP FUNCTION IF EXISTS public.log_staff_auth_action(UUID, TEXT, TEXT, JSONB);

-- (c) 감사 테이블 DROP (파괴적 — 감사행 소실. 데이터 보존 필요 시 이 문장 생략)
DROP TABLE IF EXISTS public.staff_auth_action_audit;

COMMIT;
