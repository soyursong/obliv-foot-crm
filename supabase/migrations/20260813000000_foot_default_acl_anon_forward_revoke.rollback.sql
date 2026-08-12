-- T-20260813-foot-DEFAULTACL-ANON-FORWARD-REVOKE · ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- 롤백 = postgres→anon public TABLES default-privilege 원상 복원 (prod 실측 prior state,
--   introspection BEFORE 2026-08-13): { MAINTAIN, REFERENCES, SELECT, TRIGGER }.
--   ALL 이 아니라 실측 4개만 재부여해야 정확한 원복(신규 테이블 자동상속 재개방).
-- ⚠ 이 롤백은 forward 누출 경로(신규 테이블 anon 자동상속)를 재-개방한다 — 회귀 등
--   불가피 상황에서만 사용.
-- 무영속 dry-run: 20260813000000_foot_default_acl_anon_forward_revoke.dryrun.mjs 참조.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon;

COMMIT;
