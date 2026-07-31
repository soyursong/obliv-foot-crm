-- ============================================================================
-- T-20260801-foot-STAFF-APPROVE-BTN-LOGIN-WIRING-VERIFY
--   승인 버튼 → 로그인 활성화 배선 복구.
--
-- 문제(코드분석 확정): 승인 버튼(toggleApproval)은 user_profiles.approved=true 만
--   켤 뿐, auth 레벨 email_confirmed_at 을 세팅하지 않았다. 자가회원가입(register)
--   계정은 GoTrue 가 email_confirmed_at 을 요구 → "Email not confirmed" 로 로그인
--   거부 → 현장엔 '승인했는데 로그인 안 됨'으로 표출. (자매 STAFF-REGISTER-EMAILCONFIRM
--   -GAP-SCAN 과 근본원인 동일 = email_confirmed_at 미처리 → 본 RPC 한 수정으로 수렴.)
--
-- 해법: 승인=활성화를 한 트랜잭션으로 묶는 SECURITY DEFINER RPC 신규.
--   (1) user_profiles.approved = true            (rows-affected 검증)
--   (2) auth.users.email_confirmed_at = now()    (미확인 계정만; GoTrue 로그인 거부 해소)
--   서버측 SECURITY DEFINER 로 auth.users 를 직접 쓴다 → 클라이언트 service_role 노출 0.
--   (선례: admin_reset_user_password 가 이미 auth.users.encrypted_password 직접 write.)
--
-- 표준 준수:
--   · cross_crm_auth_identity_standard — write 직전 id↔email 재검증
--     (auth.users.email == user_profiles.email 동일 id 확인, 불일치 시 abort).
--     승인 대상은 권위 id(user_profiles.id=auth.users.id) 로만 키잉 — ?email= 단독 신뢰 안 함.
--   · cross_crm_write_rowcheck_standard — GET DIAGNOSTICS ROW_COUNT 로 rows-affected 검증
--     (0-row silent write 를 EXCEPTION 으로 fail-loud).
--   · clinic 스코프 가드 — 호출자 clinic 과 대상 clinic 일치 강제(교차-clinic 승인 차단).
--
-- 성격/게이트: 비파괴(CREATE OR REPLACE FUNCTION, 신규 컬럼/테이블/enum 0, 데이터 mutation
--   은 대상 계정 activation write 뿐 = destructive auth write 아님). 기존 미활성 계정 소급
--   보정은 별건 Data-Correction Backfill SOP(1건씩) 로 처리 — blanket UPDATE 아님.
-- 롤백: 20260801090000_foot_admin_approve_confirm_email.rollback.sql
-- 작성: dev-foot / 2026-08-01
-- ============================================================================

BEGIN;

-- ── PREFLIGHT: 오적용 방지(무영속 abort) ──
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name='user_profiles') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: public.user_profiles 부재 — wrong DB?';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='auth' AND table_name='users') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: auth.users 부재 — wrong DB?';
  END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION public.admin_approve_and_confirm_user(
  target_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clinic          UUID;
  v_profile_email   TEXT;
  v_profile_clinic  UUID;
  v_profile_found   BOOLEAN := false;
  v_auth_email      TEXT;
  v_email_confirmed TIMESTAMPTZ;
  v_prof_updated    INT := 0;
  v_auth_updated    INT := 0;
  v_confirmed_now   BOOLEAN := false;
BEGIN
  -- 가드: admin/manager(/director) 만 호출 가능
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only' USING ERRCODE = '42501';
  END IF;

  -- clinic 컨텍스트(호출자 기준)
  v_clinic := public.current_user_clinic_id();
  IF v_clinic IS NULL THEN
    RAISE EXCEPTION 'caller has no clinic_id' USING ERRCODE = '22023';
  END IF;

  -- 대상 user_profiles 조회(권위 id 기준) + clinic 스코프 확보
  SELECT email, clinic_id, true
    INTO v_profile_email, v_profile_clinic, v_profile_found
  FROM public.user_profiles
  WHERE id = target_user_id;

  IF NOT COALESCE(v_profile_found, false) THEN
    RAISE EXCEPTION 'user_profiles(%) not found', target_user_id USING ERRCODE = '23503';
  END IF;

  -- clinic 스코프 가드: 교차-clinic 승인 차단
  IF v_profile_clinic IS DISTINCT FROM v_clinic THEN
    RAISE EXCEPTION 'target user belongs to another clinic' USING ERRCODE = '42501';
  END IF;

  -- cross_crm_auth_identity_standard: write 직전 id↔email 재검증.
  --   동일 id 에서 auth.users.email 과 user_profiles.email 이 일치하는지 확인.
  SELECT email, email_confirmed_at
    INTO v_auth_email, v_email_confirmed
  FROM auth.users
  WHERE id = target_user_id;

  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'auth.users(%) not found', target_user_id USING ERRCODE = '23503';
  END IF;

  IF lower(v_auth_email) IS DISTINCT FROM lower(v_profile_email) THEN
    RAISE EXCEPTION 'identity mismatch: auth.users.email != user_profiles.email for id %', target_user_id
      USING ERRCODE = '22023';
  END IF;

  -- (1) user_profiles.approved = true  — rows-affected 검증
  UPDATE public.user_profiles
  SET approved = true
  WHERE id = target_user_id;
  GET DIAGNOSTICS v_prof_updated = ROW_COUNT;

  IF v_prof_updated <> 1 THEN
    RAISE EXCEPTION 'approval write affected % rows (expected 1) — aborting', v_prof_updated
      USING ERRCODE = '23514';
  END IF;

  -- (2) auth.users.email_confirmed_at 강제(미확인 계정만).
  --   이미 확인된 계정은 건드리지 않음(멱등). GoTrue "Email not confirmed" 로그인 거부 해소.
  IF v_email_confirmed IS NULL THEN
    UPDATE auth.users
    SET email_confirmed_at = now(),
        updated_at = now()
    WHERE id = target_user_id
      AND email_confirmed_at IS NULL;
    GET DIAGNOSTICS v_auth_updated = ROW_COUNT;
    v_confirmed_now := (v_auth_updated = 1);
  END IF;

  RETURN jsonb_build_object(
    'user_id',             target_user_id,
    'approved',            true,
    'profile_rows',        v_prof_updated,
    'email_confirmed_now', v_confirmed_now,
    'already_confirmed',   (v_email_confirmed IS NOT NULL)
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.admin_approve_and_confirm_user(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_approve_and_confirm_user(UUID) TO authenticated;

COMMENT ON FUNCTION public.admin_approve_and_confirm_user(UUID) IS
  'T-20260801-foot-STAFF-APPROVE-BTN-LOGIN-WIRING-VERIFY: 계정 승인 = user_profiles.approved=true + auth.users.email_confirmed_at 강제(미확인만)를 한 트랜잭션으로. admin/manager 가드 + clinic 스코프 + id↔email 재검증 + rows-affected 검증.';

COMMIT;
