-- T-20260713-foot-AUTH-ACTOR-AUDIT-APPLEVEL — (B) STRUCTURAL, foot = canonical pilot
-- =============================================================================
-- 목적: destructive auth op(비번 재설정·활성토글(ban)·계정 등록/초대)이 실행될 때
--       "어느 로그인 staff(actor)가 트리거했는지"를 append-only 감사테이블에 기록.
--       (FACEOFANGEL/김지윤 계정 복구 때 "누가 비번을 재설정했는지 확인 불가" 근본 해결)
--
-- 근거: 부모 T-20260713-ops-AUTH-AUDITLOG-CROSS-CRM-POSTURE (B)트랙.
--       GoTrue 감사로그는 app이 service_role로 호출 → actor=service/null → 사람 귀속 불가.
--       사람 귀속은 앱이 앱-소유 감사테이블에 actor를 적을 때만 남는다.
--
-- ★ foot canonical 아키텍처 발견(copy-now 팬아웃 시 필독):
--   foot의 destructive auth op은 **HTTP GoTrue Admin API가 아니라 Postgres
--   SECURITY DEFINER RPC**로 수행된다(admin_reset_user_password / admin_toggle_user_active
--   / admin_register_user, 정의: 20260425220744_admin_account_rpcs.sql).
--   → actor stamp를 RPC 트랜잭션 내부에 넣을 수 있어 **best-effort가 아니라 원자적(atomic)**
--     으로 기록된다(op 성공↔audit 기록이 한 txn에서 함께 commit/rollback).
--     이는 부모 posture가 가정한 HTTP-txn 불가(best-effort/outbox)보다 **엄격히 우수**.
--   → HTTP GoTrue Admin API를 직접 쓰는 CRM(있다면)은 client-side best-effort insert+stamp
--     경로가 필요. foot은 DB-RPC라 in-txn 원자성 채택. (AC-4 대응 註 참조)
--
-- 스키마 성격: ADDITIVE. 기존 컬럼·PHI 테이블·기존 RLS 무변경. 신규 테이블 1 + 헬퍼함수 1.
--            기존 RPC 3종은 시그니처/반환 불변, body에 audit 기록 1줄만 추가(superset behavior).
-- 롤백: 20260713170000_foot_staff_auth_action_audit.rollback.sql
-- MIG-GATE: db_change=true → dryrun(No-Persistence) + ledger 3자대조 + rollback 4필드 의무.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- 1) 감사 테이블 (append-only)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_auth_action_audit (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- actor = 트리거한 로그인 세션 (권위 = auth.uid(), 클라이언트가 위조 불가)
  actor_user_id  UUID NOT NULL,                       -- auth.users.id (= "누가" 권위값)
  actor_staff_id UUID,                                -- staff row (admin/manager는 staff 미보유 → nullable)
  actor_email    TEXT,                                -- 가독성용 caller email (staff auth email, PHI 아님)
  actor_role     TEXT,                                -- caller role 스냅샷
  -- target = destructive op 대상
  target_user_id UUID,                                -- 대상 auth.users.id
  target_email   TEXT,                                -- 대상 staff auth email (PHI 아님, 비번 평문 금지)
  action         TEXT NOT NULL,                        -- 'password_reset'|'deactivate'|'activate'|'register'
  clinic_id      UUID,                                 -- scope
  request_meta   JSONB NOT NULL DEFAULT '{}'::jsonb,   -- 부가 컨텍스트 (비번 평문 절대 금지)
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- action 허용값 가드 (copy-now 시 CRM별 op명 확장 가능)
  CONSTRAINT staff_auth_action_audit_action_chk
    CHECK (action IN ('password_reset','deactivate','activate','register','role_change','email_change','delete','ban')),
  -- 비번 평문 유입 차단 (request_meta 에 password/new_password 키 금지)
  CONSTRAINT staff_auth_action_audit_no_plaintext_pw_chk
    CHECK (NOT (request_meta ? 'password') AND NOT (request_meta ? 'new_password'))
);

COMMENT ON TABLE  public.staff_auth_action_audit IS
  'T-20260713-foot-AUTH-ACTOR-AUDIT-APPLEVEL: destructive auth op의 사람-귀속(actor) append-only 감사. admin-read only + no update/delete. 비번 평문 적재 금지.';
COMMENT ON COLUMN public.staff_auth_action_audit.actor_user_id  IS 'auth.uid() of triggering session — 위조 불가 권위 actor';
COMMENT ON COLUMN public.staff_auth_action_audit.actor_staff_id IS 'best-effort staff.id (admin/manager는 NULL 가능)';
COMMENT ON COLUMN public.staff_auth_action_audit.target_email   IS 'staff auth email (PHI 아님). 비번 평문 금지.';

CREATE INDEX IF NOT EXISTS idx_saaa_target_user   ON public.staff_auth_action_audit (target_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_saaa_actor_user    ON public.staff_auth_action_audit (actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_saaa_occurred      ON public.staff_auth_action_audit (occurred_at DESC);

-- ─────────────────────────────────────────────────────────────────
-- 2) RLS: admin-read only + append-only(no update/delete)
--    - INSERT 는 SECURITY DEFINER 헬퍼(log_staff_auth_action)만 수행 → 직접 INSERT 정책 없음(=거부)
--    - UPDATE/DELETE 정책 없음 → authenticated 전면 거부(append-only)
--    - SELECT 는 admin 만 (contract: admin-read only)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.staff_auth_action_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_auth_action_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saaa_admin_read ON public.staff_auth_action_audit;
CREATE POLICY saaa_admin_read ON public.staff_auth_action_audit
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'admin');

-- 직접 쓰기(INSERT/UPDATE/DELETE) 권한 자체를 회수 (belt-and-suspenders; RLS 정책 부재와 이중 방어)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.staff_auth_action_audit FROM authenticated, anon, PUBLIC;
GRANT  SELECT ON public.staff_auth_action_audit TO authenticated;  -- 실제 노출은 RLS(admin)로 재차 제한

-- ─────────────────────────────────────────────────────────────────
-- 3) actor stamp 헬퍼 (SECURITY DEFINER)
--    - actor 는 클라이언트 인자가 아니라 auth.uid() 로 서버에서 확정(위조 불가)
--    - INV-4 posture: 호출 RPC가 is_admin_or_manager() 가드를 통과(=세션 존재)한 직후,
--      target 재검증 통과 후, destructive mutation 직전에 이 헬퍼를 호출한다.
--    - 호출 RPC의 트랜잭션 안에서 실행 → op 와 audit 이 원자적으로 함께 commit/rollback.
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_staff_auth_action(
  p_target_user_id UUID,
  p_target_email   TEXT,
  p_action         TEXT,
  p_request_meta   JSONB DEFAULT '{}'::jsonb
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_staff_id UUID;
  v_email    TEXT;
  v_role     TEXT;
  v_clinic   UUID;
  v_id       BIGINT;
BEGIN
  -- actor 세션 필수 (destructive RPC는 is_admin_or_manager()=세션필수 가드 뒤에서만 호출)
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'log_staff_auth_action: no authenticated actor (auth.uid() is NULL)'
      USING ERRCODE = '28000';
  END IF;

  -- actor 신원 해석 (auth.uid() 기준 — 클라이언트 인자 신뢰 안 함)
  SELECT up.email, up.role, up.clinic_id
    INTO v_email, v_role, v_clinic
  FROM public.user_profiles up
  WHERE up.id = v_actor;

  SELECT s.id INTO v_staff_id
  FROM public.staff s
  WHERE s.user_id = v_actor
  LIMIT 1;

  INSERT INTO public.staff_auth_action_audit
    (actor_user_id, actor_staff_id, actor_email, actor_role,
     target_user_id, target_email, action, clinic_id, request_meta)
  VALUES
    (v_actor, v_staff_id, v_email, v_role,
     p_target_user_id, p_target_email, p_action, v_clinic,
     COALESCE(p_request_meta, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.log_staff_auth_action(UUID, TEXT, TEXT, JSONB) IS
  'T-20260713 actor stamp: destructive auth RPC 내부에서 op 직전 호출. actor=auth.uid() 서버확정.';

REVOKE ALL ON FUNCTION public.log_staff_auth_action(UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
-- 직접 호출은 불필요(내부 RPC 전용)하나, definer 소유로 SECURITY DEFINER 실행되므로 authenticated 에 execute 부여.
GRANT EXECUTE ON FUNCTION public.log_staff_auth_action(UUID, TEXT, TEXT, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 4) 기존 destructive RPC 3종에 actor stamp 삽입 (시그니처/반환 불변, body superset)
--    각 RPC: is_admin_or_manager() 가드 통과(=세션·권한 재검증, INV-4 posture) 직후,
--    target 존재 재검증 후, destructive mutation 직전에 log_staff_auth_action() 호출.
-- ─────────────────────────────────────────────────────────────────

-- 4-1) admin_reset_user_password (비번 재설정 — password_reset)
CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
  target_user_id UUID,
  new_password TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions   -- extensions: gen_salt/crypt(pgcrypto) — 20260517000020 fix 보존
AS $$
DECLARE
  v_target_email TEXT;
BEGIN
  -- 가드 (권한·세션 재검증)
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only' USING ERRCODE = '42501';
  END IF;

  -- 비번 정책
  IF new_password IS NULL OR length(new_password) < 6 THEN
    RAISE EXCEPTION 'password too short (min 6)' USING ERRCODE = '22023';
  END IF;

  -- target 존재 재검증 + email 확보 (INV-4: id↔email 재검증 posture)
  SELECT u.email INTO v_target_email FROM auth.users u WHERE u.id = target_user_id;
  IF v_target_email IS NULL AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'auth.users(%) not found', target_user_id USING ERRCODE = '23503';
  END IF;

  -- ▼ ACTOR STAMP: destructive 호출 직전 (op 와 원자적)
  PERFORM public.log_staff_auth_action(
    target_user_id, v_target_email, 'password_reset', '{}'::jsonb
  );

  -- destructive: bcrypt 해시로 직접 업데이트 (비번 평문은 절대 audit 에 담지 않음)
  UPDATE auth.users
  SET encrypted_password = crypt(new_password, gen_salt('bf')),
      updated_at = now()
  WHERE id = target_user_id;

  RETURN jsonb_build_object('user_id', target_user_id, 'reset_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reset_user_password(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(UUID, TEXT) TO authenticated;

-- 4-2) admin_toggle_user_active (활성/비활성 = ban/unban — activate/deactivate)
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
  v_target_email TEXT;
BEGIN
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'user_profiles(%) not found', target_user_id USING ERRCODE = '23503';
  END IF;

  SELECT email INTO v_target_email FROM public.user_profiles WHERE id = target_user_id;

  -- ▼ ACTOR STAMP: destructive 토글 직전
  PERFORM public.log_staff_auth_action(
    target_user_id, v_target_email,
    CASE WHEN set_active THEN 'activate' ELSE 'deactivate' END,
    jsonb_build_object('set_active', set_active)
  );

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

-- 4-3) admin_register_user (계정 등록/초대 — register)
--      (기존 로직 전체 보존 + 매핑 성공 직전에 actor stamp 1줄 추가)
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
  -- 가드
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

  -- ▼ ACTOR STAMP: 프로필/staff 매핑(등록) 직전
  PERFORM public.log_staff_auth_action(
    target_user_id, lower(email), 'register',
    jsonb_build_object('role', role, 'approved', approved)
  );

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

COMMIT;
