-- ============================================================================
-- T-20260801-foot-STAFF-APPROVE-BTN-LOGIN-WIRING-VERIFY · 스펙4 (MSG-pdlw fold / FIELD-GO MSG-4rnu)
--   admin_reset_user_password 보강 — 비번 재설정 시 email_confirmed_at 도 세팅.
--
-- 문제: admin_reset_user_password 는 auth.users.encrypted_password 만 UPDATE 하고
--   email_confirmed_at 을 건드리지 않는다. 자가회원가입 미확인 계정(email_confirmed_at=NULL)
--   에 임시비번을 새로 줘도 GoTrue 가 "Email not confirmed" 로 로그인 거부 지속(mh.ryu 재제보
--   근본원인). → 승인 버튼(admin_approve_and_confirm_user) 뿐 아니라 비번 재설정 경로에서도
--   "계정을 로그인 가능 상태로 만든다"는 불변식이 깨져 있었다.
--
-- 해법: CREATE OR REPLACE admin_reset_user_password — 기존 로직 보존 + email_confirmed_at 이
--   NULL 이면 now() 로 강제(미확인만; 이미 확인된 계정은 무변경 = 멱등). 두 write(비번·이메일확인)
--   각각 GET DIAGNOSTICS ROW_COUNT 로 rows-affected 검증(cross_crm_write_rowcheck_standard).
--   서버측 SECURITY DEFINER 실행 → service_role 클라 노출 0. 시그니처 무변경(overload 미생성).
--
-- 성격/게이트: 비파괴(CREATE OR REPLACE, 신규 컬럼/테이블/enum 0). 대상 계정 activation write.
-- 롤백: 20260801093000_foot_admin_reset_password_confirm_email.rollback.sql
--   (⚠ email_confirmed_at 값은 되돌리지 않음 — 활성 계정 보존. 함수만 이전 정의로 복원.)
-- 작성: dev-foot / 2026-08-01
-- ============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='auth' AND table_name='users') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: auth.users 부재 — wrong DB?';
  END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
  target_user_id UUID,
  new_password TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_email_confirmed TIMESTAMPTZ;
  v_exists          BOOLEAN := false;
  v_pw_updated      INT := 0;
  v_conf_updated    INT := 0;
  v_confirmed_now   BOOLEAN := false;
BEGIN
  -- 가드
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only' USING ERRCODE = '42501';
  END IF;

  -- 비번 정책
  IF new_password IS NULL OR length(new_password) < 6 THEN
    RAISE EXCEPTION 'password too short (min 6)' USING ERRCODE = '22023';
  END IF;

  -- target 존재 확인 + 현재 email_confirmed_at 상태 확보
  SELECT true, email_confirmed_at
    INTO v_exists, v_email_confirmed
  FROM auth.users
  WHERE id = target_user_id;

  IF NOT COALESCE(v_exists, false) THEN
    RAISE EXCEPTION 'auth.users(%) not found', target_user_id USING ERRCODE = '23503';
  END IF;

  -- bcrypt 해시로 직접 업데이트 (gen_salt는 pgcrypto → extensions 스키마) — rows-affected 검증
  UPDATE auth.users
  SET encrypted_password = crypt(new_password, gen_salt('bf')),
      updated_at = now()
  WHERE id = target_user_id;
  GET DIAGNOSTICS v_pw_updated = ROW_COUNT;

  IF v_pw_updated <> 1 THEN
    RAISE EXCEPTION 'password write affected % rows (expected 1) — aborting', v_pw_updated
      USING ERRCODE = '23514';
  END IF;

  -- ★스펙4: email_confirmed_at 이 NULL 이면 now() 강제(미확인만). 비번만 바꾸고 여전히 로그인
  --   거부되던 gap 봉합. 이미 확인된 계정은 무변경(멱등).
  IF v_email_confirmed IS NULL THEN
    UPDATE auth.users
    SET email_confirmed_at = now(),
        updated_at = now()
    WHERE id = target_user_id
      AND email_confirmed_at IS NULL;
    GET DIAGNOSTICS v_conf_updated = ROW_COUNT;
    v_confirmed_now := (v_conf_updated = 1);
  END IF;

  RETURN jsonb_build_object(
    'user_id',             target_user_id,
    'reset_at',            now(),
    'email_confirmed_now', v_confirmed_now,
    'already_confirmed',   (v_email_confirmed IS NOT NULL)
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.admin_reset_user_password(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_reset_user_password(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_reset_user_password(UUID, TEXT) IS
  'T-20260801 스펙4: 비번 재설정 + email_confirmed_at NULL이면 now() 강제(미확인만). admin/manager 가드 + rows-affected 검증. 비번·이메일확인 두 경로 모두 로그인가능 불변식 충족.';

COMMIT;
