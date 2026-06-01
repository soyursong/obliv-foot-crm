-- T-20260601-foot-HEALTHQ-SELFLINK-FAIL (ESCALATION-2, 3회차 reopen)
--
-- 진짜 근본원인 (16:40 검증/현장 실패 모순의 정체):
--   gen_random_bytes 는 pgcrypto → `extensions` 스키마에 존재.
--   health_q 토큰 발급 SECURITY DEFINER 함수 3종은 proconfig 가
--   {search_path=public} 로 고정되어 있어, 함수 내부에서 extensions 스키마를
--   찾지 못함 → 호출 시 `ERROR: function gen_random_bytes(integer) does not exist`.
--
--   · superuser(postgres)로 직접 호출하면 권한 체크(staff/auth.uid())에서 먼저
--     'unauthorized' 로 반환되어 line 28(gen_random_bytes)에 도달하지 못함
--     → dev 의 16:40 검증은 토큰 생성식만 superuser search_path(extensions 포함)
--       에서 확인 → "정상" 오판.
--   · 현장(authenticated 역할)은 권한 체크를 통과한 뒤 line 28 에서 search_path=public
--     때문에 gen_random_bytes 미해석 → 100% 실패.
--   ∴ 20260601000050(base64url→url-safe) 수정은 실제였으나, 그 앞단의
--     gen_random_bytes search_path 문제를 못 봐 현장 실패가 지속됨.
--
-- 검증(라이브 DB, rollback 트랜잭션):
--   authenticated JWT(김주연 ee67fc6b)로 ALTER 전 호출 → gen_random_bytes 에러.
--   search_path=public,extensions 적용 후 동일 호출 →
--     {"success":true,"token":"B5L1TfccRe1_fQRBBBQiyGomhjBjTs9h",...} (url-safe 확인).
--
-- 수정: 토큰 발급 함수 3종 search_path 에 extensions 추가 + 컬럼 DEFAULT 의
--       gen_random_bytes 를 extensions 로 스키마 한정. 함수 본문은 건드리지 않음(최소·additive).
-- 데이터 변경/삭제 없음. 멱등(재실행 안전).

BEGIN;

-- 1) 토큰 발급 함수 3종: search_path 에 extensions 추가 (본문 불변)
ALTER FUNCTION fn_health_q_create_token(uuid, uuid, text, uuid, integer)
  SET search_path = public, extensions;

ALTER FUNCTION fn_selfcheckin_create_health_q_token(uuid, uuid)
  SET search_path = public, extensions;

ALTER FUNCTION fn_dashboard_reissue_health_q_token(text, text, text)
  SET search_path = public, extensions;

-- 2) 컬럼 DEFAULT: gen_random_bytes 스키마 한정 (search_path 무관하게 항상 해석되도록)
ALTER TABLE health_q_tokens
  ALTER COLUMN token
  SET DEFAULT translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');

COMMIT;

-- PostgREST 스키마 캐시 리로드 (proconfig 변경 반영)
SELECT pg_notify('pgrst', 'reload schema');
