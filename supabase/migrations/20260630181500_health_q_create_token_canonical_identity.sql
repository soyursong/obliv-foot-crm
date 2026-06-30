-- T-20260630-foot-PENCHART-HEALTHQ-CODY-LINKPERM — 펜차트 발건강질문지 '링크 생성' 코디(coordinator) 실패
--
-- ⚠️ DO NOT APPLY 자율 금지 — data-architect CONSULT(ADDITIVE 권한확대) GO + supervisor DDL-diff 게이트 후 적용.
--    (SECURITY DEFINER 함수의 인가 경계 변경 = PHI 토큰 발급 권한 확대 → §S2.4 데이터 정책 게이트)
--
-- ── 확정 RC (PROD READ-ONLY 실측, 2026-06-30) ──
--   fn_health_q_create_token(6-arg) 의 인가 게이트만 "비정규" 신원 소스
--   (staff.user_id = auth.uid()) 를 사용. 로그인 신원은 user_profiles 기준인데 staff.user_id 는
--   희소 → coordinator 7명(user_profiles) 중 5명이 staff.user_id 미연결 → 'unauthorized' 반환.
--     · PROD 실측: user_profiles coordinator=7, 그 중 staff.user_id 미연결=5.
--     · 연결된 coordinator(김지혜 등)는 정상 — 2026-06-30 17:52 KST 토큰 2건 생성 성공(실측).
--     · admin/manager/원장 무회귀: 이들은 staff.user_id 연결됨(legacy 게이트 통과).
--   ★ 이 outlier 는 T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE 가 health_q SELECT 정책에서
--     이미 진단·수정(staff.user_id → is_approved_user()+current_user_clinic_id())한 것과 동일.
--     그때 SELECT 정책만 정규화했고 create-token RPC(INSERT 경로)는 누락 → 본 티켓이 그 잔여 outlier.
--   ★ 티켓 1차 가설("coordinator role 권한 미부여 / admin 한정 RLS")은 반증됨:
--       EXECUTE = authenticated/PUBLIC(전역), INSERT RLS = clinic 스코프(role 필터 無),
--       함수 owner=postgres(BYPASSRLS) → RLS 우회. 유일 게이트 = 위 staff.user_id 조회.
--
-- ── 수정 (인가 게이트만, ADDITIVE 무회귀) ──
--   인가 = 정규신원(user_profiles, is_approved_user() AND clinic) OR 레거시(staff.user_id) 의 union.
--     → 기존 통과자(staff 연결자) 전원 유지 + approved user_profiles 직원(미연결 coordinator 포함) 추가.
--   created_by 는 staff(id) FK(ON DELETE SET NULL) → staff.id best-effort 해석(미연결 시 NULL, FK 안전).
--   ★ 토큰 본체 = REGRESS4(20260629143000) 와 byte-identical (AC-4):
--       search_path = public, extensions / extensions.gen_random_bytes / translate(encode(...,'base64'),'+/=','-_').
--   ★ health_q_tokens RLS 정책 미접촉 (ADDITIVE 는 함수 인가 로직에 한정, RLS 변경 0).
--
-- ── AC 매핑 ──
--   AC-1: coordinator(미연결 포함) 링크 생성 정상 — 일반(ko)/외국인용(en) 둘 다(form_type='general' 공통).
--   AC-2: admin/manager/원장(director) 무회귀 — legacy staff 게이트 union 으로 보존.
--   AC-3: coordinator 한정 아님 — approved+active 전 직원(동일 clinic)으로 정규화(SELECT 정책과 정합).
--   AC-4: 토큰 발급 본체(REGRESS4) 무변경, RLS 미변경. 인가 게이트만 ADDITIVE 확대.
--
-- 시그니처 동일(6-arg) → DROP 불요, GRANT 멱등 재부여. 데이터 변경/삭제 없음. FE 변경 0.
-- 롤백: 20260630181500_health_q_create_token_canonical_identity.rollback.sql
--
-- 적용 (supervisor, CONSULT GO + DDL-diff 후):
--   pg 직접연결 또는 supabase db push --file <이 파일>

BEGIN;

CREATE OR REPLACE FUNCTION fn_health_q_create_token(
  p_customer_id  UUID,
  p_clinic_id    UUID,
  p_form_type    TEXT    DEFAULT 'general',
  p_check_in_id  UUID    DEFAULT NULL,
  p_expires_days INT     DEFAULT 7,
  p_lang         TEXT    DEFAULT 'ko'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions          -- REGRESS4 보존: extensions 포함
AS $$
DECLARE
  v_staff_id  UUID;
  v_new_token TEXT;
  v_new_id    UUID;
  v_lang      TEXT;
BEGIN
  v_lang := COALESCE(NULLIF(p_lang, ''), 'ko');

  -- created_by 용 staff.id best-effort (staff(id) FK, 미연결 시 NULL 허용)
  SELECT id INTO v_staff_id
  FROM   staff
  WHERE  user_id    = auth.uid()
    AND  clinic_id  = p_clinic_id
  LIMIT 1;

  -- 인가 게이트 (ADDITIVE union, 무회귀):
  --   (1) 정규 신원(user_profiles): approved+active AND 본인 clinic — 미연결 coordinator 포함 전 직원.
  --   (2) 레거시(staff.user_id) 통과자 — 기존 권한 보존(admin/manager/원장 등).
  -- T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE 가 SELECT 정책에 적용한 정규화를 create 경로에 확장.
  IF NOT (
       (is_approved_user() AND p_clinic_id = current_user_clinic_id())
       OR v_staff_id IS NOT NULL
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  -- 기존 미사용 토큰 만료 (1인 1활성토큰)
  UPDATE health_q_tokens
  SET    expires_at = now() - INTERVAL '1 second'
  WHERE  customer_id = p_customer_id
    AND  clinic_id   = p_clinic_id
    AND  form_type   = p_form_type
    AND  used_at     IS NULL
    AND  expires_at  > now();

  -- 새 토큰 발급 — REGRESS4 본체 그대로(extensions.gen_random_bytes + base64 url-safe translate)
  v_new_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');

  INSERT INTO health_q_tokens (
    token, customer_id, clinic_id, check_in_id,
    form_type, lang, expires_at, created_by
  )
  VALUES (
    v_new_token,
    p_customer_id,
    p_clinic_id,
    p_check_in_id,
    p_form_type,
    v_lang,
    now() + (p_expires_days || ' days')::INTERVAL,
    v_staff_id
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'success', true,
    'token',   v_new_token,
    'id',      v_new_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_health_q_create_token(UUID, UUID, TEXT, UUID, INT, TEXT) TO authenticated;

COMMIT;

-- PostgREST 스키마 캐시 리로드
SELECT pg_notify('pgrst', 'reload schema');
