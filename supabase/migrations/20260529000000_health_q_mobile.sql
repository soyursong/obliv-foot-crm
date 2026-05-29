-- T-20260529-foot-HEALTH-Q-MOBILE
-- 발건강질문지 모바일 고객 자가작성 — 토큰 + 결과 저장 스키마
--
-- 신규 테이블 2개: health_q_tokens, health_q_results
-- 신규 RPC 3개: fn_health_q_validate_token, fn_health_q_submit, fn_health_q_create_token
--
-- 롤백: 20260529000000_health_q_mobile.rollback.sql
--
-- 적용 방법 (supervisor 실행):
--   supabase db push --file supabase/migrations/20260529000000_health_q_mobile.sql
--
-- 설계:
--   직원 → fn_health_q_create_token → token URL → 고객 /health-q/:token
--   고객 → fn_health_q_validate_token (anon) → 폼 작성 → fn_health_q_submit
--   직원 → health_q_results 조회 (PenChartTab)

-- ─── 1. health_q_tokens ────────────────────────────────────────────────────────
-- 직원이 발급, 고객에게 URL로 공유. used_at 설정 시 만료.
CREATE TABLE IF NOT EXISTS health_q_tokens (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  token        TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'base64url'),
  customer_id  UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  clinic_id    UUID        NOT NULL REFERENCES clinics(id),
  check_in_id  UUID        REFERENCES check_ins(id) ON DELETE SET NULL,
  form_type    TEXT        NOT NULL DEFAULT 'general'
                             CHECK (form_type IN ('general', 'senior')),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  used_at      TIMESTAMPTZ,
  created_by   UUID        REFERENCES staff(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_q_tokens_token    ON health_q_tokens(token);
CREATE INDEX IF NOT EXISTS idx_health_q_tokens_customer ON health_q_tokens(customer_id);
CREATE INDEX IF NOT EXISTS idx_health_q_tokens_clinic   ON health_q_tokens(clinic_id, created_at DESC);

COMMENT ON TABLE health_q_tokens IS
  'T-20260529-foot-HEALTH-Q-MOBILE: 고객 자가작성 발건강질문지 접근 토큰.
   직원이 fn_health_q_create_token으로 생성 → URL(/health-q/:token) 고객에게 공유.
   used_at NULL + expires_at > now() 일 때만 유효.';

-- ─── 2. health_q_results ──────────────────────────────────────────────────────
-- 고객 제출 결과 영구 보관.
CREATE TABLE IF NOT EXISTS health_q_results (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  token_id      UUID        REFERENCES health_q_tokens(id) ON DELETE SET NULL,
  customer_id   UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  clinic_id     UUID        NOT NULL REFERENCES clinics(id),
  check_in_id   UUID        REFERENCES check_ins(id) ON DELETE SET NULL,
  form_type     TEXT        NOT NULL DEFAULT 'general',
  form_data     JSONB       NOT NULL,
  storage_path  TEXT,
  submitted_at  TIMESTAMPTZ DEFAULT now(),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_q_results_customer ON health_q_results(customer_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_q_results_clinic   ON health_q_results(clinic_id, submitted_at DESC);

COMMENT ON TABLE health_q_results IS
  'T-20260529-foot-HEALTH-Q-MOBILE: 고객이 모바일로 제출한 발건강질문지 구조화 데이터.
   form_data JSONB: {symptoms, nail_locations, pain_duration, pain_severity,
                     medical_history, medications, allergies, prior_conditions,
                     family_history, visit_purpose, referral_source}.
   storage_path: documents 버킷 JSON 경로 (optional 백업).';

-- ─── 3. RLS ───────────────────────────────────────────────────────────────────

-- health_q_tokens RLS
ALTER TABLE health_q_tokens ENABLE ROW LEVEL SECURITY;

-- 직원: 본인 클리닉 조회
CREATE POLICY "hq_tokens_staff_select" ON health_q_tokens
  FOR SELECT USING (
    clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid())
  );

-- 직원: 본인 클리닉 토큰 생성 (RPC SECURITY DEFINER도 사용하나 직접 INSERT도 허용)
CREATE POLICY "hq_tokens_staff_insert" ON health_q_tokens
  FOR INSERT WITH CHECK (
    clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid())
  );

-- health_q_results RLS
ALTER TABLE health_q_results ENABLE ROW LEVEL SECURITY;

-- 직원: 본인 클리닉 결과 조회
CREATE POLICY "hq_results_staff_select" ON health_q_results
  FOR SELECT USING (
    clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid())
  );

-- ─── 4. RPC: fn_health_q_validate_token ──────────────────────────────────────
-- anon + authenticated: 토큰 유효성 검증, 고객 정보 반환
CREATE OR REPLACE FUNCTION fn_health_q_validate_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok   health_q_tokens%ROWTYPE;
  v_name  TEXT;
BEGIN
  SELECT * INTO v_tok
  FROM   health_q_tokens
  WHERE  token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_not_found');
  END IF;

  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_used');
  END IF;

  IF v_tok.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_expired');
  END IF;

  SELECT name INTO v_name
  FROM   customers
  WHERE  id = v_tok.customer_id;

  RETURN jsonb_build_object(
    'success',       true,
    'token_id',      v_tok.id,
    'customer_id',   v_tok.customer_id,
    'customer_name', COALESCE(v_name, ''),
    'clinic_id',     v_tok.clinic_id,
    'check_in_id',   v_tok.check_in_id,
    'form_type',     v_tok.form_type
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_health_q_validate_token(TEXT) TO anon, authenticated;

-- ─── 5. RPC: fn_health_q_submit ───────────────────────────────────────────────
-- anon + authenticated: 제출 저장 + 토큰 사용 처리 (FOR UPDATE로 이중제출 방지)
CREATE OR REPLACE FUNCTION fn_health_q_submit(
  p_token        TEXT,
  p_form_data    JSONB,
  p_storage_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok      health_q_tokens%ROWTYPE;
  v_result_id UUID;
BEGIN
  -- FOR UPDATE: 동시 제출 race condition 방지
  SELECT * INTO v_tok
  FROM   health_q_tokens
  WHERE  token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_not_found');
  END IF;

  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_submitted');
  END IF;

  IF v_tok.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_expired');
  END IF;

  INSERT INTO health_q_results (
    token_id, customer_id, clinic_id, check_in_id,
    form_type, form_data, storage_path, submitted_at
  )
  VALUES (
    v_tok.id, v_tok.customer_id, v_tok.clinic_id, v_tok.check_in_id,
    v_tok.form_type, p_form_data, p_storage_path, now()
  )
  RETURNING id INTO v_result_id;

  UPDATE health_q_tokens
  SET    used_at = now()
  WHERE  id = v_tok.id;

  RETURN jsonb_build_object(
    'success',    true,
    'result_id',  v_result_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_health_q_submit(TEXT, JSONB, TEXT) TO anon, authenticated;

-- ─── 6. RPC: fn_health_q_create_token ────────────────────────────────────────
-- authenticated(직원 전용): 고객용 토큰 생성. 동일 고객/form_type 미사용 토큰은 먼저 만료.
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
  v_staff_id UUID;
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

  -- 새 토큰 발급
  v_new_token := encode(gen_random_bytes(24), 'base64url');

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
