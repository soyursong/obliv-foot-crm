-- T-20260512-foot-CONTRACT-ALIGN §B
-- Staff role enum 확장 (5종 → 표준 8종) + user_profiles 'director' 추가
-- + normalize_phone() SQL 함수 (Cross-CRM 계약 §1)
-- + admin_register_user RPC role 검증 확장
-- 롤백: 20260513000040_contract_align_roles.down.sql

BEGIN;

-- ──────────────────────────────────────────────────────────────────
-- B-1. staff.role CHECK 확장 (5종 → 표준 8종)
--  기존: director / consultant / coordinator / therapist / technician
--  추가: admin / manager / tm
--  데이터 변경 없음 — CHECK 교체만
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE public.staff
  ADD CONSTRAINT staff_role_check
  CHECK (role IN (
    'admin','manager','director','consultant',
    'coordinator','therapist','technician','tm'
  ));

-- ──────────────────────────────────────────────────────────────────
-- B-2. user_profiles.role CHECK 확장 ('director' 추가)
--  기존(migration 20260422000003): admin/manager/consultant/coordinator/
--                                   therapist/technician/tm/staff
--  추가: director
--  'staff'는 레거시 값으로 유지
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN (
    'admin','manager','director','consultant',
    'coordinator','therapist','technician','tm','staff'
  ));

-- ──────────────────────────────────────────────────────────────────
-- B-3. admin_register_user RPC role 검증 확장
--  'director' 추가, 임상직(v_clinical) 판단에도 포함
-- ──────────────────────────────────────────────────────────────────
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

  -- role 검증 (표준 8종 + 레거시 staff)
  IF role NOT IN (
    'admin','manager','director','consultant',
    'coordinator','therapist','technician','tm','staff'
  ) THEN
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
  --   임상직(director/consultant/coordinator/therapist/technician)만 staff row와 연결
  --   admin/manager/tm/staff는 staff 행 생성 skip
  v_clinical := role IN ('director','consultant','coordinator','therapist','technician');

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

-- ──────────────────────────────────────────────────────────────────
-- A. normalize_phone() SQL 함수 (Cross-CRM 계약 §1)
--  010-1234-5678 / 01012345678 / +82... → +821012345678 (E.164)
--  변환 불가능한 값은 원본 그대로 반환 (non-destructive)
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE
    -- 이미 E.164 (+82...)
    WHEN p_phone ~ '^\+82' THEN p_phone
    -- 01X 시작 한국 번호 (하이픈/공백 제거 후 변환)
    WHEN regexp_replace(p_phone, '[^0-9]', '', 'g') ~ '^01[016789][0-9]{7,8}$'
      THEN '+82' || substring(regexp_replace(p_phone, '[^0-9]', '', 'g') from 2)
    -- 변환 불가 → 원본 반환
    ELSE p_phone
  END;
$$;

COMMIT;

-- 사후 검증 쿼리:
-- SELECT public.normalize_phone('010-1234-5678');   -- +821012345678
-- SELECT public.normalize_phone('+821012345678');   -- +821012345678 (no-op)
-- SELECT public.normalize_phone('01012345678');     -- +821012345678
-- SELECT public.normalize_phone('UNKNOWN');          -- UNKNOWN (원본)
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'staff'::regclass AND contype = 'c';
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'user_profiles'::regclass AND contype = 'c';
