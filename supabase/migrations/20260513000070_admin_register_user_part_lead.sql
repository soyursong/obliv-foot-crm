-- T-20260513-foot-ACCT-SIGNUP-RPC-GAP: admin_register_user part_lead/director 역할 지원 추가
--
-- 문제: UI에서 part_lead 선택 가능하지만 RPC 역할 검증 목록에 없어 EXCEPTION 발생
-- 해결: RPC 역할 목록 + user_profiles CHECK 제약에 part_lead, director 추가
--
-- 롤백: 20260513000070_admin_register_user_part_lead.down.sql

BEGIN;

-- 1) user_profiles role CHECK 제약 확장
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin','manager','director','part_lead','consultant','coordinator','therapist','technician','tm','staff'));

-- 2) admin_register_user: part_lead, director 역할 허용 + auth.users 체크 강화(설명 주석 추가)
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
  -- 참고: Supabase는 이미 등록된 이메일로 signUp 시 가짜 UUID를 반환하고 auth.users에 row를 만들지 않음.
  -- 이 체크가 실패하는 경우 대부분 중복 이메일 시도이며, 클라이언트에서 identities[] 빈 배열로 먼저 감지해야 함.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'auth.users(%) not found — 중복 이메일 또는 signUp 미완료. identities 배열을 확인하세요', target_user_id USING ERRCODE = '23503';
  END IF;

  -- role 검증 (user_profiles CHECK constraint와 일치)
  IF role NOT IN ('admin','manager','director','part_lead','consultant','coordinator','therapist','technician','tm','staff') THEN
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
  --   - admin/manager/director/part_lead/tm/staff는 staff 행 생성 skip
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

COMMIT;
