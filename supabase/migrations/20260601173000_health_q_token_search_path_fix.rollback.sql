-- ROLLBACK: T-20260601-foot-HEALTHQ-SELFLINK-FAIL (ESCALATION-2)
--
-- ⚠️ 경고: 이 롤백은 토큰 발급 함수의 search_path 를 다시 {public} 으로 되돌려
--          gen_random_bytes 미해석 → 링크 생성 100% 실패 상태로 회귀시킨다.
--          비상용. 정상 운영 중에는 절대 사용 금지.
--
-- 적용: psql / supabase db query 로 직접 실행.

BEGIN;

ALTER FUNCTION fn_health_q_create_token(uuid, uuid, text, uuid, integer)
  SET search_path = public;

ALTER FUNCTION fn_selfcheckin_create_health_q_token(uuid, uuid)
  SET search_path = public;

ALTER FUNCTION fn_dashboard_reissue_health_q_token(text, text, text)
  SET search_path = public;

ALTER TABLE health_q_tokens
  ALTER COLUMN token
  SET DEFAULT translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');

COMMIT;

SELECT pg_notify('pgrst', 'reload schema');
