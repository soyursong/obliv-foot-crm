-- T-20260629-foot-HEALTHQ-SELFLINK-REGRESS4 — 펜차트 발건강질문지 자가작성 링크 생성 실패 (4차 재발)
--
-- ── 근본원인 (PROD 실측 확정, READ-ONLY inspect 스크립트 + responder MSG-20260629-120229-v9bd) ──
--   PROD 실측 결과 (2026-06-29):
--     fn_health_q_create_token(uuid,uuid,text,uuid,integer,text)  ← 6-arg
--       proconfig = {search_path=public}     ← extensions 누락 (회귀!)
--       본문        = encode(gen_random_bytes(24),'base64url')   ← bare, schema 미한정
--     → gen_random_bytes 는 extensions 스키마(pgcrypto) 소재인데 search_path=public 만이라
--       authenticated 역할 호출 시 'function gen_random_bytes(integer) does not exist' → 100% 실패.
--       일반/외국인용이 동일 RPC 사용 → 둘 다 실패 (현장 신고와 정확히 일치).
--   ★ 라이브 트랜잭션 검증(BEGIN..ROLLBACK)에서 두 번째 폭탄 발견:
--       search_path 만 고치면 다음 줄 encode(...,'base64url') 에서 'unrecognized encoding: base64url'.
--       PostgreSQL(17.6 포함)은 base64url 인코딩을 지원하지 않는다. 6/25 가 6/1 의 검증된
--       translate(encode(...,'base64'),'+/=','-_') 를 base64url 로 바꾼 게 잠재 폭탄이었고,
--       gen_random_bytes 에러에 가려 그동안 드러나지 않았다 → search_path 만 고쳤으면 5차 재발 확정.
--
-- ── 왜 6/1 fix(20260601173000)가 안 막혔나 = AC-4 핵심 ──
--   6/1 fix 는 ALTER FUNCTION ... SET search_path=public,extensions 로 **함수 attribute** 만 고쳤다.
--   6/25 배포(20260625120000_health_q_lang)가 p_lang 추가하며 5-arg DROP → 6-arg CREATE 재생성,
--   이때 search_path=public 만 설정 → 6/1 의 attribute 가 통째로 날아감(무효화).
--   ∴ search_path attribute 만의 fix 는 함수 재생성마다 휘발 → 28일 주기 재발(밴드에이드).
--
-- ── 영속 방지책 (재발 차단) ──
--   같은 토큰 발급 함수 fn_selfcheckin_create_health_q_token 은 4차 재발에도 안 깨졌다.
--   이유: 그 함수 본문이 extensions.gen_random_bytes 로 **schema-qualified** 되어 있어
--         search_path 재설정과 무관하게 항상 해석됨.
--   → 본 fix 도 동일 패턴 적용: (1) search_path=public,extensions 복원(즉시 fix, responder 확정안)
--                              (2) 본문 gen_random_bytes → extensions.gen_random_bytes(영속, 재생성 내성)
--   향후 누가 이 함수를 또 재생성해도, 본문이 schema-qualified 인 한 깨지지 않는다.
--
-- 변경: fn_health_q_create_token(6-arg) CREATE OR REPLACE.
--       · 시그니처 동일(6-arg) → DROP 불요, GRANT 유지(멱등 위해 재부여).
--       · 본문 = 20260625120000 정의와 동일, gen_random_bytes 만 extensions. 한정.
--       · search_path = public, extensions.
-- 데이터 변경/삭제 없음. 멱등(재실행 안전). 코드(FE) 변경 0.
-- 롤백: 20260629143000_health_q_create_token_searchpath_permanent_fix.rollback.sql
--
-- 적용 (supervisor 실행, DDL-diff 게이트 후):
--   supabase db push --file supabase/migrations/20260629143000_health_q_create_token_searchpath_permanent_fix.sql

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
SET search_path = public, extensions          -- (1) 즉시 fix: extensions 복원
AS $$
DECLARE
  v_staff_id  UUID;
  v_new_token TEXT;
  v_new_id    UUID;
  v_lang      TEXT;
BEGIN
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

  -- 새 토큰 발급 — (2) 영속 fix: gen_random_bytes 를 extensions 로 schema-qualify
  --   (selfcheckin 함수와 동일 패턴. 함수 재생성·search_path drift 와 무관하게 항상 해석됨)
  -- (3) 인코딩 fix: 'base64url' 은 PostgreSQL(17.6 포함) 미지원 → 호출 시
  --   'unrecognized encoding: "base64url"' 에러. 6/25(20260625120000)가 6/1 의 검증된
  --   url-safe 방식을 base64url 로 바꾼 게 두 번째 폭탄(gen_random_bytes 에러에 가려 미발견).
  --   fn_selfcheckin/fn_dashboard_reissue 와 동일한 translate(encode(...,'base64'),'+/=','-_')
  --   로 복원 → 토큰 함수 3종 인코딩 통일.
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

-- PostgREST 스키마 캐시 리로드 (proconfig 변경 반영)
SELECT pg_notify('pgrst', 'reload schema');
