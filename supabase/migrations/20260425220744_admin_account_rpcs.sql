-- T-20260420-foot-048: 계정 관리 RPC 3종 (SECURITY DEFINER + admin/manager 가드)
--
-- 1) admin_register_user(target_user_id, email, name, role, approved, staff_id?, link_existing_staff)
--    - auth.users는 호출자가 signUp으로 먼저 생성 (Accounts.tsx의 signupClient 패턴)
--    - 본 RPC는 user_profiles upsert + staff.user_id 매핑/생성을 한 트랜잭션으로
-- 2) admin_reset_user_password(target_user_id, new_password)
--    - auth.users.encrypted_password를 crypt(new_password, gen_salt('bf'))로 직접 업데이트
--    - pgcrypto는 Supabase 기본 활성화
-- 3) admin_toggle_user_active(target_user_id, set_active)
--    - user_profiles.active + staff.active 동기화 (staff는 user_id 매핑된 row만)
--
-- 가드: is_admin_or_manager() (foot-006에서 정의됨)
-- 롤백: 20260425220744_admin_account_rpcs.down.sql

BEGIN;

-- pgcrypto 보장 (Supabase 기본 활성, idempotent)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────
-- 1) admin_register_user
-- ─────────────────────────────────────────────────────────────────
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
  -- 가드: admin/manager만 호출 가능
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only' USING ERRCODE = '42501';
  END IF;

  -- clinic 컨텍스트 (호출자 기준)
  v_clinic := public.current_user_clinic_id();
  IF v_clinic IS NULL THEN
    RAISE EXCEPTION 'caller has no clinic_id' USING ERRCODE = '22023';
  END IF;

  -- target user_id 존재 확인 (auth.users)
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'auth.users(% ) not found — call signUp first', target_user_id USING ERRCODE = '23503';
  END IF;

  -- role 검증 (user_profiles CHECK constraint와 일치)
  IF role NOT IN ('admin','manager','consultant','coordinator','therapist','technician','tm','staff') THEN
    RAISE EXCEPTION 'invalid role: %', role USING ERRCODE = '22023';
  END IF;

  -- user_profiles upsert
  INSERT INTO public.user_profiles (id, email, name, role, clinic_id, approved, active)
  VALUES (target_user_id, lower(email), name, role, v_clinic, approved, true)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    clinic_id = EXCLUDED.clinic_id,
    approved = EXCLUDED.approved,
    active = true;

  -- staff 매핑 정책:
  --   - 임상직(consultant/coordinator/therapist/technician)만 staff row와 연결
  --   - admin/manager/tm/staff는 staff 행 생성 skip
  --   - staff_id 인자 있으면 해당 row 매핑 (단, clinic 일치 + user_id NULL 또는 동일 user 한정)
  --   - staff_id 인자 없고 임상직이면 동명·동역할 staff(user_id NULL) 자동 매칭, 없으면 신규 생성
  v_clinical := role IN ('consultant','coordinator','therapist','technician');

  IF v_clinical THEN
    -- user_profiles.role → staff.role 매핑 (1:1)
    v_staff_role := role;

    IF staff_id IS NOT NULL THEN
      -- 명시적 staff 지정: 해당 row 검증 후 매핑
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
      -- 자동 매칭: 동명·동역할 + user_id NULL
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
        -- 신규 staff 생성
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

-- ─────────────────────────────────────────────────────────────────
-- 2) admin_reset_user_password
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
  target_user_id UUID,
  new_password TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  -- 가드
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only' USING ERRCODE = '42501';
  END IF;

  -- 비번 정책
  IF new_password IS NULL OR length(new_password) < 6 THEN
    RAISE EXCEPTION 'password too short (min 6)' USING ERRCODE = '22023';
  END IF;

  -- target 존재 확인
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'auth.users(%) not found', target_user_id USING ERRCODE = '23503';
  END IF;

  -- bcrypt 해시로 직접 업데이트
  UPDATE auth.users
  SET encrypted_password = crypt(new_password, gen_salt('bf')),
      updated_at = now()
  WHERE id = target_user_id;

  RETURN jsonb_build_object('user_id', target_user_id, 'reset_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_user_password(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3) admin_toggle_user_active
-- ─────────────────────────────────────────────────────────────────
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

  -- user_profiles 토글
  UPDATE public.user_profiles
  SET active = set_active
  WHERE id = target_user_id;

  -- 매핑된 staff row 동기화
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

COMMIT;
