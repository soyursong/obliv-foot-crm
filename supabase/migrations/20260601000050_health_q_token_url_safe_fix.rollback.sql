-- ROLLBACK: T-20260601-foot-HEALTHQ-SELFLINK-FAIL
--
-- ⚠️ 경고: 이 롤백은 토큰 생성식을 다시 'base64url'(PostgreSQL 미지원, 항상 실패)
--          상태로 되돌린다. 이전 상태는 비정상(링크 생성 100% 실패)이므로 비상용.
--          정상 운영 중에는 절대 사용 금지.
--
-- 적용: psql/supabase db query 로 직접 실행.

BEGIN;

ALTER TABLE health_q_tokens
  ALTER COLUMN token SET DEFAULT encode(gen_random_bytes(24), 'base64url');

-- 함수 3개는 token 생성 라인을 base64url 로 되돌려 재정의해야 한다.
-- 정의가 길어 본 롤백에서는 직전 migration 파일을 재적용하는 것을 권장:
--   supabase db query < 20260529000050_health_q_create_token_hotfix.sql
--   supabase db query < 20260529001000_selfcheckin_personal_info_fn.sql
--   supabase db query < 20260529030000_dashboard_reissue_health_q_token.sql

COMMIT;

SELECT pg_notify('pgrst', 'reload schema');
