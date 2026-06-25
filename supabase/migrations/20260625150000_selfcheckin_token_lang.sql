-- T-20260625-foot-FOREIGN-SELFCHECKIN-FLOW
--
-- 목적: 외국인 셀프접수(English 분기) 완료 후 발급되는 발건강질문지 QR 토큰을
--       영문(lang='en') 으로 발급할 수 있도록 anon RPC fn_selfcheckin_create_health_q_token
--       에 p_lang 파라미터를 추가한다.
--
-- 배경:
--   · health_q_tokens.lang 컬럼 + fn_health_q_validate_token(lang 반환)은
--     20260625120000_health_q_lang.sql 에서 이미 적용됨(prod 실적용 확인).
--   · 그러나 셀프접수 경로 전용 토큰 발급 함수(fn_selfcheckin_create_health_q_token,
--     anon SECURITY DEFINER)는 lang 을 세팅하지 않아 항상 DEFAULT 'ko' 로 발급 →
--     외국인이 셀프접수해도 QR 진입 시 한국어 설문이 뜸.
--   · 본 마이그는 이 함수에 p_lang(DEFAULT 'ko')을 더해 lang 을 INSERT 에 반영.
--     기존 호출(2-arg named)은 p_lang 생략 → DEFAULT 'ko' 로 후방호환.
--
-- 스키마 변경: 컬럼/테이블 0건 (함수 시그니처 확장만). DA CONSULT-REPLY 신규컬럼 0건 정합.
--
-- 시그니처 변경(2-arg → 3-arg)이므로 기존 2-arg DROP 후 재생성.
--   · 20260601173000 에서 2-arg 에 부여한 search_path=public,extensions 를 재생성 본문에
--     인라인으로 재적용(gen_random_bytes 가 extensions 스키마에 존재 — 누락 시 100% 실패).
--   · GRANT anon, authenticated 재부여.
--
-- 롤백: 20260625150000_selfcheckin_token_lang.rollback.sql
-- 적용(supervisor DB-gate): supabase db push --file supabase/migrations/20260625150000_selfcheckin_token_lang.sql
-- 데이터 변경/삭제 없음. 멱등(재실행 안전).

BEGIN;

DROP FUNCTION IF EXISTS public.fn_selfcheckin_create_health_q_token(UUID, UUID);

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_create_health_q_token(
  p_check_in_id UUID,
  p_clinic_id   UUID,
  p_lang        TEXT DEFAULT 'ko'   -- T-20260625-FOREIGN-SELFCHECKIN: en/ko (앱레벨 검증, DB CHECK 없음)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ci     check_ins%ROWTYPE;
  v_token  TEXT;
  v_tok_id UUID;
  v_lang   TEXT;
BEGIN
  -- lang: 빈값/NULL → ko (후방호환). 허용 코드 검증은 앱레벨(LANGUAGE_OPTIONS).
  v_lang := COALESCE(NULLIF(p_lang, ''), 'ko');

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

  -- 새 토큰 발급 (24시간 유효) — url-safe (translate base64)
  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');

  INSERT INTO health_q_tokens (
    token, customer_id, clinic_id, check_in_id,
    form_type, lang, expires_at, created_by
  )
  VALUES (
    v_token,
    v_ci.customer_id,
    p_clinic_id,
    p_check_in_id,
    'general',
    v_lang,
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

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_create_health_q_token(UUID, UUID, TEXT)
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_create_health_q_token IS
  'T-20260529-FLOW-REVAMP + T-20260625-FOREIGN-SELFCHECKIN: 셀프접수 완료 후 발건강질문지 QR 토큰 발급.'
  ' anon SECURITY DEFINER — 30분 이내 check_in + clinic_id 이중 검증.'
  ' p_lang(DEFAULT ko) → health_q_tokens.lang 적재(외국인 en 분기). 1인 1활성토큰(24h).';

COMMIT;

-- PostgREST 스키마 캐시 리로드 (시그니처 변경 반영)
SELECT pg_notify('pgrst', 'reload schema');
