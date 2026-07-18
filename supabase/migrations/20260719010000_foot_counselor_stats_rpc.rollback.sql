-- ============================================================================
-- ROLLBACK: 20260719010000_foot_counselor_stats_rpc
-- T-20260718-foot-CRM-COUNSELOR-STATS-RPC-PROXY (leg a)
--
-- 역연산: get_counselor_stats 함수 DROP. ADDITIVE 마이그의 완전 역산.
-- dopamine_stats_reader role 은 유지(NOLOGIN, 무해). FOOT_STATS_ROLE_KEY JWT 가 이 role
--   claim 을 참조할 수 있어 role DROP 은 blast-radius 확대 → 롤백 시에도 role 존치.
--   (role 자체를 제거하려면 별도 게이트로 GRANT 참조 0 확인 후 DROP ROLE.)
-- 테이블·컬럼·데이터 변경 없었으므로 데이터 롤백 불요.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_counselor_stats(UUID[], DATE, DATE);

-- (선택) role 참조 0 확인 후에만 아래 주석 해제:
-- REVOKE dopamine_stats_reader FROM authenticator;
-- DROP ROLE IF EXISTS dopamine_stats_reader;
