-- ROLLBACK — T-20260715-foot-SELFCHECKIN-LEGACYCREATE-SOURCECLOSE-HEAL Phase A
-- 원복: EXECUTE 재부여(회수 전 proacl 실측 = anon/authenticated/service_role 명시 grant 보유) + deprecated 주석 제거.
-- 주의: 회수 전 proacl 에 PUBLIC(=X) 은 없었음(allowlist 20260710223000 이 이미 회수) → PUBLIC 재부여 안 함.
--       회수 전 실측: {postgres=X, anon=X, authenticated=X, service_role=X}.

BEGIN;

GRANT EXECUTE ON FUNCTION public.self_checkin_create(text, text, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.self_checkin_create(text, text, text) IS NULL;

COMMIT;
