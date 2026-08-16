-- DRY-RUN (No-Persistence): T-20260814-foot-ADMINREGUSER-QUALIFY-PORT
-- SSOT: women 20260810235500 dryrun (commit a148f4c9) → foot mechanical 이식.
-- Migration Dry-Run No-Persistence Protocol 준수 (migration_dryrun_no_persistence_standard.md v1.0):
--   · up.sql 의 txn-control 문(BEGIN/COMMIT)을 **제거** → 본 파일의 BEGIN..ROLLBACK 자체로 무영속.
--   · txn 내부 assertion: CREATE OR REPLACE 후 prosrc 가 alias-qualified 형태(`FROM public.staff s`
--       + `s.name = admin_register_user.name` + `s.role = v_staff_role`)로 교체됐고, 시그니처(arity 6·
--       SECDEF)·GRANT tier(authenticated)·SET search_path 불변인지 구조검증. 실패 시 RAISE → abort(무영속).
--   ⚠ 완전 behavioral(auth.uid()/service_role 세션 + 실제 임상직 자동매칭 경로 → ambiguity 미발화 확인)은
--     supervisor DB-GATE live S1/S1b/S1c 재실행에서 수행. dryrun 은 auth.uid()=NULL → RPC 가드
--     (is_admin_or_manager) 미통과 → 구조검증으로 대체. post-probe(ROLLBACK 이후 prosrc==22f7ee69 무영속)은
--     supervisor 러너 introspection.

BEGIN;

-- ── PREFLIGHT (C10 pg_proc 기준선 재확인) ────────────────────────────────
DO $preflight$
DECLARE
  v_cnt int;
  v_secdef bool;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name='staff') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: public.staff 부재 — wrong DB?';
  END IF;
  -- admin_register_user(UUID,TEXT,TEXT,TEXT,BOOLEAN,UUID) 단독 arity·SECDEF 확인
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='admin_register_user';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: admin_register_user 오버로드 count=% (기대 1·단독 arity)', v_cnt;
  END IF;
  SELECT p.prosecdef INTO v_secdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='admin_register_user';
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: admin_register_user 가 SECURITY DEFINER 아님 — 기준선 불일치';
  END IF;
END $preflight$;

-- ── up.sql 본문 (txn-control 제거·CREATE OR REPLACE 동일) ─────────────────
CREATE OR REPLACE FUNCTION public.admin_register_user(
  target_user_id UUID, email TEXT, name TEXT, role TEXT,
  approved BOOLEAN DEFAULT true, staff_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_clinic UUID; v_existing_staff_id UUID; v_new_staff_id UUID; v_staff_role TEXT; v_clinical BOOLEAN;
BEGIN
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only' USING ERRCODE = '42501';
  END IF;
  v_clinic := public.current_user_clinic_id();
  IF v_clinic IS NULL THEN
    RAISE EXCEPTION 'caller has no clinic_id' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'auth.users(%) not found', target_user_id USING ERRCODE = '23503';
  END IF;
  IF role NOT IN ('admin','manager','director','part_lead','consultant','coordinator','therapist','technician','tm','staff') THEN
    RAISE EXCEPTION 'invalid role: %', role USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.user_profiles (id, email, name, role, clinic_id, approved, active)
  VALUES (target_user_id, lower(email), admin_register_user.name, admin_register_user.role, v_clinic, approved, true)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email, name = EXCLUDED.name, role = EXCLUDED.role,
    clinic_id = EXCLUDED.clinic_id, approved = EXCLUDED.approved, active = true;
  v_clinical := role IN ('consultant','coordinator','therapist','technician');
  IF v_clinical THEN
    v_staff_role := role;
    IF staff_id IS NOT NULL THEN
      SELECT s.id INTO v_existing_staff_id FROM public.staff s
      WHERE s.id = admin_register_user.staff_id AND s.clinic_id = v_clinic
        AND (s.user_id IS NULL OR s.user_id = target_user_id);
      IF v_existing_staff_id IS NULL THEN
        RAISE EXCEPTION 'staff(%) not found', staff_id USING ERRCODE = '23503';
      END IF;
      UPDATE public.staff s SET user_id = target_user_id, active = true WHERE s.id = v_existing_staff_id;
      v_new_staff_id := v_existing_staff_id;
    ELSE
      SELECT s.id INTO v_existing_staff_id FROM public.staff s
      WHERE s.clinic_id = v_clinic AND s.name = admin_register_user.name
        AND s.role = v_staff_role AND s.user_id IS NULL LIMIT 1;
      IF v_existing_staff_id IS NOT NULL THEN
        UPDATE public.staff s SET user_id = target_user_id, active = true WHERE s.id = v_existing_staff_id;
        v_new_staff_id := v_existing_staff_id;
      ELSE
        INSERT INTO public.staff (clinic_id, name, role, active, user_id)
        VALUES (v_clinic, admin_register_user.name, v_staff_role, true, target_user_id)
        RETURNING id INTO v_new_staff_id;
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('user_id', target_user_id, 'staff_id', v_new_staff_id,
    'clinical', v_clinical, 'clinic_id', v_clinic);
END;
$$;

-- ── in-txn assertion (구조검증) ──────────────────────────────────────────
DO $chk$
DECLARE
  v_src text;
  v_secdef bool;
  v_args text;
BEGIN
  SELECT p.prosrc, p.prosecdef, pg_get_function_identity_arguments(p.oid)
    INTO v_src, v_secdef, v_args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='admin_register_user';

  -- 시그니처 불변 (caller Accounts.tsx 6-arg 호환)
  IF v_args NOT ILIKE '%uuid%text%text%text%boolean%uuid%' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 시그니처 변경 감지 (args=%)', v_args;
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: SECURITY DEFINER 소실';
  END IF;

  -- A1 (DA CONSULT MSG-20260811-035530-wup1, HARD-CRITICAL): SET search_path 가드 보존 assert.
  --   SECURITY DEFINER 함수의 search_path 소실 시 INVOKER-유사 해석 drift → §15-5-10 seal 붕괴.
  --   prod-live(22f7ee69)·up.sql 공히 `SET search_path = public, auth` → 보존 필수(byte-behavioral).
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='admin_register_user'
      AND array_to_string(p.proconfig, ' | ') LIKE '%search_path=%'
      AND array_to_string(p.proconfig, ' | ') LIKE '%public%'
      AND array_to_string(p.proconfig, ' | ') LIKE '%auth%'
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: SET search_path=public,auth 가드 소실/변경 (A1) — proconfig=%',
      (SELECT p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='admin_register_user');
  END IF;

  -- alias-qualify 적용 확인 (ambiguity fix 핵심)
  IF v_src NOT LIKE '%FROM public.staff s%' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: staff alias(s) qualify 미적용 — fix 누락';
  END IF;
  IF v_src NOT LIKE '%s.name = admin_register_user.name%' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 자동매칭 SELECT 좌변 s.name qualify 미적용';
  END IF;
  IF v_src NOT LIKE '%s.role = v_staff_role%' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 자동매칭 SELECT 좌변 s.role qualify 미적용';
  END IF;

  RAISE NOTICE 'DRYRUN-OK: admin_register_user body alias-qualified(FROM public.staff s · s.name/s.role) · 시그니처 6-arg 불변 · SECDEF 유지 · SET search_path=public,auth 보존(A1) · ambiguity RC 해소.';
END $chk$;

ROLLBACK;
