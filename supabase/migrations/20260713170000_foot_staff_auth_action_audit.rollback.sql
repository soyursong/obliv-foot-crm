-- ROLLBACK: T-20260713-foot-AUTH-ACTOR-AUDIT-APPLEVEL (v0.4)
-- =============================================================================
-- 되돌림: 신규 함수 2 + 감사테이블 DROP. (기존 RPC 3종은 이 마이그에서 무변경 → 복원 불요.)
-- 註(v0.4): 테이블 전체 DROP 이므로 actor_user_id NOT NULL 신규컬럼은 별도 롤백문 불요(테이블과 함께 소거).
-- 註(데이터 보존): 적재된 감사행 보존이 필요하면 마지막 DROP TABLE 문을 생략하고 함수만 DROP.
--    파괴적 완전 롤백이 필요할 때만 DROP TABLE 실행(감사 무결성상 신중히).
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.stamp_auth_action_outcome(BIGINT, TEXT);
DROP FUNCTION IF EXISTS public.record_auth_action(UUID, TEXT, TEXT, JSONB);
DROP TABLE IF EXISTS public.staff_auth_action_audit;

COMMIT;
