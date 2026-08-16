-- T-20260814-foot-ADMINREGUSER-QUALIFY-PORT (부모 T-20260810-meta-ADMINREGUSER-AMBIGUITY-XFORK-SWEEP)
-- canonical SSOT: women 마이그 20260810235500_women_admin_register_user_qualify_ambiguous.sql (commit a148f4c9)
--   → foot mechanical 이식 (byte-identical fork drift — women==foot 선재 잠복결함 동일 md5 22f7ee69).
--
-- 문제 (supervisor foot prod 실측 RC, INFO MSG-20260814-034203-sgq5): admin_register_user(SECDEF)
--   자동매칭 SELECT 의 좌변 `name`/`role` 가 unqualified → plpgsql 파라미터(name/role)와 staff 컬럼
--   (staff.name/staff.role)이 충돌하여 `column reference "name" is ambiguous` (42702) RAISE.
--   발현 경계: 임상직(consultant/coordinator/therapist/technician) 且 staff_id 미지정
--   (자동매칭 → 신규생성 경로)만 해당 statement 실행 → 100% 실패.
--   foot prod live md5(prosrc)=22f7ee6978c7b9ee71d31c4bf61f2572 (취약본 라이브 잔존 확정).
--
-- 해결: staff 참조 SELECT/UPDATE/INSERT 를 테이블 alias `s` 로 qualify 하여 파라미터/컬럼 ambiguity 제거.
--   + user_profiles VALUES 를 admin_register_user.name/.role 로 명시(파라미터 qualify).
--   ★시그니처 변경 금지(caller: src/pages/Accounts.tsx supabase.rpc 6-arg 호환) — 파라미터 rename 불가.
--   qualify 방식만. 그 외 로직(가드·role 검증·user_profiles upsert·보상경로) 전부 무접촉.
--
-- change-class: ADDITIVE-equivalent (function body replace only, 시그니처·GRANT·스키마 무접촉).
-- 롤백: 20260814034400_foot_admin_register_user_qualify_ambiguous.rollback.sql
--   (= foot prod live 현 body 복원, md5 22f7ee69 기준)
-- ★ apply 는 supervisor DB-GATE 물리 GO-token 이후에만 (apply_before_go 금지).

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
    RAISE EXCEPTION 'auth.users(%) not found — 중복 이메일 또는 signUp 미완료. identities 배열을 확인하세요', target_user_id USING ERRCODE = '23503';
  END IF;

  -- role 검증 (user_profiles CHECK constraint와 일치)
  IF role NOT IN ('admin','manager','director','part_lead','consultant','coordinator','therapist','technician','tm','staff') THEN
    RAISE EXCEPTION 'invalid role: %', role USING ERRCODE = '22023';
  END IF;

  -- user_profiles upsert
  INSERT INTO public.user_profiles (id, email, name, role, clinic_id, approved, active)
  VALUES (target_user_id, lower(email), admin_register_user.name, admin_register_user.role, v_clinic, approved, true)
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
      -- 명시적 staff 지정: 해당 row 검증 후 매핑 (alias s 로 qualify)
      SELECT s.id INTO v_existing_staff_id
      FROM public.staff s
      WHERE s.id = admin_register_user.staff_id
        AND s.clinic_id = v_clinic
        AND (s.user_id IS NULL OR s.user_id = target_user_id);

      IF v_existing_staff_id IS NULL THEN
        RAISE EXCEPTION 'staff(%) not found in clinic or already linked to other user', staff_id USING ERRCODE = '23503';
      END IF;

      UPDATE public.staff s
      SET user_id = target_user_id,
          active = true
      WHERE s.id = v_existing_staff_id;

      v_new_staff_id := v_existing_staff_id;
    ELSE
      -- 자동 매칭: 동명·동역할 + user_id NULL (alias s 로 qualify — ambiguity fix 핵심)
      SELECT s.id INTO v_existing_staff_id
      FROM public.staff s
      WHERE s.clinic_id = v_clinic
        AND s.name = admin_register_user.name
        AND s.role = v_staff_role
        AND s.user_id IS NULL
      LIMIT 1;

      IF v_existing_staff_id IS NOT NULL THEN
        UPDATE public.staff s
        SET user_id = target_user_id,
            active = true
        WHERE s.id = v_existing_staff_id;
        v_new_staff_id := v_existing_staff_id;
      ELSE
        -- 신규 staff 생성 (컬럼 리스트 = 명시 컬럼, VALUES = qualified 파라미터/지역변수)
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

-- GRANT 재확인 (C23 tier: staff-facing — authenticated EXECUTE 정당, 기존 GRANT 유지)
REVOKE ALL ON FUNCTION public.admin_register_user(UUID, TEXT, TEXT, TEXT, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_register_user(UUID, TEXT, TEXT, TEXT, BOOLEAN, UUID) TO authenticated;

-- PostgREST 스키마 캐시 리로드(RPC 재정의 반영, §23 convention)
NOTIFY pgrst, 'reload schema';

COMMIT;
