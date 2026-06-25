-- T-20260625-foot-FOREIGN-HEALTHQ-EN
-- 외국인 전용 설문지(영문) — health_q_tokens.lang 영속화 (ADDITIVE)
--
-- DA CONSULT-REPLY(MSG-20260625-142740-supp) GO+ADDITIVE:
--   Q1 → health_q_tokens.lang TEXT NOT NULL DEFAULT 'ko' (ADDITIVE 1컬럼, 백필 불요)
--   Q2 → form_data JSONB 기존 키 재사용 (DDL 0)
--
-- 변경:
--   1) health_q_tokens.lang 컬럼 추가 (DEFAULT 'ko' — 기존 row 자동 'ko')
--   2) fn_health_q_validate_token → 반환 객체에 lang 추가
--   3) fn_health_q_create_token → p_lang 파라미터 추가 (DEFAULT 'ko'), lang 적재
--      ※ 시그니처 변경(파라미터 추가)이므로 기존 5-arg 함수 DROP 후 6-arg 재생성.
--        FE는 named-param 호출이므로 p_lang 생략 시 DEFAULT 'ko'로 매칭됨(후방호환).
--
-- 롤백: 20260625120000_health_q_lang.rollback.sql
--
-- 적용 (supervisor 실행):
--   supabase db push --file supabase/migrations/20260625120000_health_q_lang.sql

-- ─── 1. health_q_tokens.lang (ADDITIVE) ──────────────────────────────────────
-- DA 확정(Q1): DB CHECK 없음 — 앱레벨 LANGUAGE_OPTIONS 5코드(ko/en/ja/zh-CN/zh-TW) 검증.
--   (customers.language / derm 선례와 통일. 향후 다국어 확장 시 DDL 변경 불요)
ALTER TABLE health_q_tokens
  ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'ko';

COMMENT ON COLUMN health_q_tokens.lang IS
  'T-20260625-foot-FOREIGN-HEALTHQ-EN: 설문지 표시 언어 스냅샷. ko(기본)|en|ja|zh-CN|zh-TW.
   발급 시점 freeze(customers.language 파생, 발급 후 불변). DB CHECK 없음 — 앱레벨 검증.
   외국인 셀프접수/직원 발급 시 en 토큰 → HealthQMobilePage 영문 분기 렌더.';

-- ─── 2. fn_health_q_validate_token (lang 반환 추가) ──────────────────────────
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
    'form_type',     v_tok.form_type,
    'lang',          COALESCE(v_tok.lang, 'ko')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_health_q_validate_token(TEXT) TO anon, authenticated;

-- ─── 3. fn_health_q_create_token (p_lang 추가) ───────────────────────────────
-- 시그니처 변경(5-arg → 6-arg)이므로 기존 함수 DROP 후 재생성.
DROP FUNCTION IF EXISTS fn_health_q_create_token(UUID, UUID, TEXT, UUID, INT);

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
SET search_path = public
AS $$
DECLARE
  v_staff_id  UUID;
  v_new_token TEXT;
  v_new_id    UUID;
  v_lang      TEXT;
BEGIN
  -- lang: 명시 override(p_lang) 우선, 빈값/NULL → ko. 허용 코드 검증은 앱레벨(FE).
  -- (DA Q1: customers.language COALESCE 자동상속은 customers.language 컬럼 신설=FOREIGN-LANG-SAVE
  --  배포 후 별도 배선 — 현재 미존재 컬럼 참조 시 create_token 전체 깨짐 방지 위해 override만 사용)
  v_lang := COALESCE(NULLIF(p_lang, ''), 'ko');

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

-- ─── 4. health_q_results form_data 키 사전 갱신 (DA Q2 #3 의무) ───────────────
-- 외국인 발각질케어 신규 문항 키 등록 (form_data JSONB ADDITIVE, DDL 0):
--   foot_concern_symptoms (array, 신규)  — 발 고민 증상 (callus 전용). symptoms 와 별개 키.
--   allergies            (string, 재사용) — 알레르기 종류 기입 (has_allergy=true 시).
--   medications          (array, 재사용)  — 기존 4번 복용약 재사용.
--   _lang                (string, meta)   — 답변 설문 언어(self-describing, token join 끊겨도 보존).
COMMENT ON TABLE health_q_results IS
  'T-20260529-foot-HEALTH-Q-MOBILE: 고객이 모바일로 제출한 발건강질문지 구조화 데이터.
   form_data JSONB(공통): {symptoms, symptoms_other, nail_treatment_history, nail_treatment_methods,
                     symptom_onset, family_history_type, foot_pain_level,
                     medical_history, medical_history_other, medications, medications_other,
                     treatment_start_timing, visit_frequency, has_private_insurance, insurance_company}.
   form_data JSONB(외국인 발각질, T-20260625-FOREIGN-HEALTHQ-EN): {visit_purpose, foot_concern_symptoms[],
                     has_allergy(bool), allergies(string), medications[], _lang}.
   저장값=언어중립 canonical(KO 라벨=시스템 stable 코드, EN/KO 동일 직렬화).
   storage_path: documents 버킷 JSON 경로 (optional 백업).';

-- ─── PostgREST schema cache 강제 reload ──────────────────────────────────────
SELECT pg_notify('pgrst', 'reload schema');
