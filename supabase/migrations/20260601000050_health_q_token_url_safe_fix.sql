-- T-20260601-foot-HEALTHQ-SELFLINK-FAIL — 발건강질문지 자가작성 링크 생성 실패 (재발) 근본 수정
--
-- ── 진짜 원인 (AC-4) ─────────────────────────────────────────────────────────
--   토큰 생성식 `encode(gen_random_bytes(24), 'base64url')` 의 'base64url' 은
--   PostgreSQL encode() 가 지원하지 않는 인코딩이다. encode() 는 'base64' / 'hex'
--   / 'escape' 만 지원하며, 'base64url' 호출 시 런타임에
--     ERROR: unrecognized encoding: "base64url"
--   를 던진다 → INSERT 직전 함수가 항상 실패.
--
--   5/29 hotfix(20260529000050)는 PostgREST 스키마 캐시 stale(PGRST202 "function
--   not found")만 처리하고, 동일한 깨진 'base64url' 식으로 함수를 재정의했다.
--   결과: 증상이 "함수 못 찾음" → "encoding 에러" 로 바뀌었을 뿐 실패는 그대로
--   재발. (스키마 캐시도, GRANT/RLS도 아니었고 토큰 생성식 자체가 원인)
--
-- ── 수정 ─────────────────────────────────────────────────────────────────────
--   URL-safe 토큰을 표준 base64 로 만든 뒤 URL-unsafe 문자만 치환:
--     translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_')
--   '+' → '-', '/' → '_', '=' → 제거.  (24바이트 → 32자, 패딩 없음)
--   외부 함수/추상화 없이 깨진 식만 인라인 치환 (최소 변경).
--
--   동일 버그가 health_q_tokens 에 토큰을 INSERT 하는 네 곳에 모두 존재하므로
--   같은 테이블의 동일 근본 원인을 한 번에 제거한다 (재신고 방지):
--     1. fn_health_q_create_token            (본 티켓 핵심 — HealthQResultsPanel)
--     2. fn_selfcheckin_create_health_q_token (셀프접수 QR)
--     3. fn_dashboard_reissue_health_q_token  (대시보드 재발급)
--     4. health_q_tokens.token 컬럼 DEFAULT
--
-- ── 롤백 ─────────────────────────────────────────────────────────────────────
--   20260601000050_health_q_token_url_safe_fix.rollback.sql (이전 base64url 상태로
--   복원 — 단, 이전 상태는 항상 실패하는 비정상 상태이므로 비상용).
--
-- ── 스키마 변경 여부 ─────────────────────────────────────────────────────────
--   신규 컬럼/테이블 없음. 함수 본문 재정의(동일 시그니처) + 컬럼 DEFAULT 식 변경뿐.

BEGIN;

-- ─── 1. fn_health_q_create_token (본 티켓 핵심) ───────────────────────────────
CREATE OR REPLACE FUNCTION fn_health_q_create_token(
  p_customer_id  UUID,
  p_clinic_id    UUID,
  p_form_type    TEXT    DEFAULT 'general',
  p_check_in_id  UUID    DEFAULT NULL,
  p_expires_days INT     DEFAULT 7
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id  UUID;
  v_new_token TEXT;
  v_new_id    UUID;
BEGIN
  -- 직원 권한 확인
  SELECT id INTO v_staff_id
  FROM   staff
  WHERE  user_id    = auth.uid()
    AND  clinic_id  = p_clinic_id
  LIMIT 1;

  IF NOT FOUND THEN
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

  -- 새 토큰 발급 (URL-safe base64)
  v_new_token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');

  INSERT INTO health_q_tokens (
    token, customer_id, clinic_id, check_in_id,
    form_type, expires_at, created_by
  )
  VALUES (
    v_new_token,
    p_customer_id,
    p_clinic_id,
    p_check_in_id,
    p_form_type,
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

GRANT EXECUTE ON FUNCTION fn_health_q_create_token(UUID, UUID, TEXT, UUID, INT) TO authenticated;

-- ─── 2. fn_selfcheckin_create_health_q_token (셀프접수 QR) ────────────────────
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_create_health_q_token(
  p_check_in_id UUID,
  p_clinic_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ci     check_ins%ROWTYPE;
  v_token  TEXT;
  v_tok_id UUID;
BEGIN
  -- check_in 존재 + clinic_id 일치 확인
  SELECT * INTO v_ci
  FROM   check_ins
  WHERE  id        = p_check_in_id
    AND  clinic_id = p_clinic_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  -- 30분 이내 생성된 체크인만 허용
  IF v_ci.checked_in_at < (now() - INTERVAL '30 minutes') THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_old');
  END IF;

  -- customer_id 필수
  IF v_ci.customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_customer_id');
  END IF;

  -- 동일 고객의 미사용 기존 토큰 만료 (1인 1활성토큰 원칙)
  UPDATE health_q_tokens
  SET    expires_at = now() - INTERVAL '1 second'
  WHERE  customer_id = v_ci.customer_id
    AND  clinic_id   = p_clinic_id
    AND  form_type   = 'general'
    AND  used_at     IS NULL
    AND  expires_at  > now();

  -- 새 토큰 발급 (24시간 유효, URL-safe base64)
  v_token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');

  INSERT INTO health_q_tokens (
    token, customer_id, clinic_id, check_in_id,
    form_type, expires_at, created_by
  )
  VALUES (
    v_token,
    v_ci.customer_id,
    p_clinic_id,
    p_check_in_id,
    'general',
    now() + INTERVAL '24 hours',
    NULL
  )
  RETURNING id INTO v_tok_id;

  RETURN jsonb_build_object(
    'success', true,
    'token',   v_token,
    'id',      v_tok_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_create_health_q_token(UUID, UUID)
  TO anon, authenticated;

-- ─── 3. fn_dashboard_reissue_health_q_token (대시보드 재발급) ─────────────────
CREATE OR REPLACE FUNCTION public.fn_dashboard_reissue_health_q_token(
  p_customer_phone TEXT,
  p_clinic_slug    TEXT,
  p_customer_name  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id   UUID;
  v_customer_id UUID;
  v_cust_name   TEXT;
  v_token       TEXT;
  v_tok_id      UUID;
  v_phone_alt   TEXT;   -- +82 ↔ 010 전환용
BEGIN
  -- ── 1. clinic 조회 ─────────────────────────────────────────────────────────
  SELECT id INTO v_clinic_id
  FROM   clinics
  WHERE  slug = p_clinic_slug
  LIMIT  1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'clinic_not_found');
  END IF;

  -- ── 2. 전화번호 정규화 (E.164 ↔ 국내 010 형식 두 버전 모두 시도) ────────────
  IF p_customer_phone LIKE '+82%' THEN
    v_phone_alt := '0' || substring(p_customer_phone FROM 4);
  ELSIF p_customer_phone LIKE '010%' OR p_customer_phone LIKE '011%' OR p_customer_phone LIKE '016%' THEN
    v_phone_alt := '+82' || substring(p_customer_phone FROM 2);
  ELSE
    v_phone_alt := NULL;
  END IF;

  -- ── 3. 고객 조회 (전화번호 두 형식 모두 시도) ──────────────────────────────
  SELECT id, name INTO v_customer_id, v_cust_name
  FROM   customers
  WHERE  clinic_id = v_clinic_id
    AND  phone IN (p_customer_phone, v_phone_alt)
  ORDER BY created_at ASC
  LIMIT  1;

  IF NOT FOUND THEN
    v_cust_name := COALESCE(NULLIF(TRIM(p_customer_name), ''), '미등록');
    INSERT INTO customers (clinic_id, name, phone)
    VALUES (v_clinic_id, v_cust_name, p_customer_phone)
    RETURNING id, name INTO v_customer_id, v_cust_name;
  ELSE
    IF p_customer_name IS NOT NULL AND TRIM(p_customer_name) <> '' AND v_cust_name = '미등록' THEN
      UPDATE customers SET name = TRIM(p_customer_name) WHERE id = v_customer_id;
      v_cust_name := TRIM(p_customer_name);
    END IF;
  END IF;

  -- ── 4. 기존 미사용 토큰 만료 (1인 1활성토큰) ───────────────────────────────
  UPDATE health_q_tokens
  SET    expires_at = now() - INTERVAL '1 second'
  WHERE  customer_id = v_customer_id
    AND  clinic_id   = v_clinic_id
    AND  form_type   = 'general'
    AND  used_at     IS NULL
    AND  expires_at  > now();

  -- ── 5. 신규 토큰 발급 (24h 유효, URL-safe base64) ─────────────────────────
  v_token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');

  INSERT INTO health_q_tokens (token, customer_id, clinic_id, form_type, expires_at, created_by)
  VALUES (v_token, v_customer_id, v_clinic_id, 'general', now() + INTERVAL '24 hours', NULL)
  RETURNING id INTO v_tok_id;

  RETURN jsonb_build_object(
    'success',       true,
    'token',         v_token,
    'id',            v_tok_id,
    'customer_name', v_cust_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_dashboard_reissue_health_q_token(TEXT, TEXT, TEXT)
  TO anon, authenticated;

-- ─── 4. health_q_tokens.token 컬럼 DEFAULT (잠재 landmine 제거) ───────────────
ALTER TABLE health_q_tokens
  ALTER COLUMN token SET DEFAULT translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');

COMMIT;

-- ─── PostgREST schema cache 강제 reload (안전망) ─────────────────────────────
SELECT pg_notify('pgrst', 'reload schema');
