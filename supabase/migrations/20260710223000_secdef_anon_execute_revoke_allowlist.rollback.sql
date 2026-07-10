-- ROLLBACK: T-20260710-foot-SECDEF-ANON-REVOKE
-- 20260710223000_secdef_anon_execute_revoke_allowlist.sql 원복 (긴급 회복 전용).
--
-- ⚠ 적용 시 anon 이 public 스키마 전 함수(Tier-A 돈-함수 포함)를 다시 EXECUTE 가능 = §16-3c RLS-우회 표면 재개방.
--   화이트리스트 miss 로 셀프서비스(예약/체크인/문진) 정당 흐름이 파손됐고 즉시 원복이 유일 회복책일 때만.
--
-- 프로드 원상태(본 마이그 적용 직전) 재현:
--   전 함수 proacl = =X/postgres(PUBLIC) | postgres=X | anon=X | authenticated=X | service_role=X
--   pg_default_acl(postgres 창조) = PUBLIC 기본부여 + anon/authenticated/service_role 명시부여
--
-- 멱등: GRANT / ALTER DEFAULT PRIVILEGES 반복 무해. 데이터 무변경(proacl 만).

BEGIN;

-- ── 1) 소급 재부여 (existing) — PUBLIC + anon 복원 ──
--    PUBLIC 재부여로 표준 기본상태(전원 EXECUTE) 복원 + anon 명시부여도 복원.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;

-- ── 2) 신규 상속 복원 (future, postgres 창조 경로) ──
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon;

COMMIT;

-- 검증 (rollback 후):
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--     WHERE n.nspname='public' AND has_function_privilege('anon',p.oid,'EXECUTE');  -- 기대: 119(원상)
--   SELECT has_function_privilege('anon','public.transfer_package_atomic(uuid,uuid)','EXECUTE');  -- 기대: true(원상)
