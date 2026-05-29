-- T-20260529-crm-SELFCHECKIN-QR-REISSUE
-- 대시보드에서 발건강질문지 QR 재발급 (anon SECURITY DEFINER)
--
-- 목적: happy-flow-queue AdminDashboard에서 footCrmClient(anon)으로 호출
--       초진 고객이 셀프접수 태블릿에서 QR 화면을 놓쳤을 때 데스크가 재발급
--
-- 보안 설계:
--   - anon 접근 허용 (SECURITY DEFINER) — 내부 admin 도구, anon key는 클라이언트에 이미 노출
--   - p_clinic_slug + p_customer_phone 조합 → 실제 클리닉 + 고객 존재 검증
--   - 고객 미존재 시 최소 레코드 upsert (이름 제공 시 업데이트)
--   - 신규 토큰 발급 전 기존 미사용 토큰 만료 (1인 1활성토큰)
--   - 토큰 유효시간: 24h
--
-- 호출 예시 (FE/footCrmClient):
--   footCrmClient.rpc('fn_dashboard_reissue_health_q_token', {
--     p_customer_phone: '+821012345678',
--     p_clinic_slug: 'jongno-foot',
--     p_customer_name: '홍길동',
--   })
--
-- 반환: { success, token, customer_name }  또는 { success: false, error }

BEGIN;

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
  -- E.164(+821012345678) → 010 변환
  IF p_customer_phone LIKE '+82%' THEN
    v_phone_alt := '0' || substring(p_customer_phone FROM 4);
  -- 010xxx → +82 변환
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
    -- 대시보드에서 호출 = 고객이 이미 접수된 상황이므로 최소 레코드 생성
    v_cust_name := COALESCE(NULLIF(TRIM(p_customer_name), ''), '미등록');
    INSERT INTO customers (clinic_id, name, phone)
    VALUES (v_clinic_id, v_cust_name, p_customer_phone)
    RETURNING id, name INTO v_customer_id, v_cust_name;
  ELSE
    -- 이름이 제공된 경우 업데이트 (기존 '미등록' 레코드 보정)
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

  -- ── 5. 신규 토큰 발급 (24h 유효) ──────────────────────────────────────────
  v_token := encode(gen_random_bytes(24), 'base64url');

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

COMMENT ON FUNCTION public.fn_dashboard_reissue_health_q_token IS
  'T-20260529-crm-SELFCHECKIN-QR-REISSUE: 대시보드에서 발건강질문지 QR 재발급.'
  ' anon SECURITY DEFINER — clinic_slug + customer_phone 이중 검증.'
  ' 고객 미존재 시 최소 레코드 생성. 기존 미사용 토큰 만료 후 24h 토큰 신규 발급.';

COMMIT;
