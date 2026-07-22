-- ROLLBACK — T-20260723-foot-JONGNO-KIOSK-READPATH-ANON-CUTOVER 착수조건 ①
-- ============================================================================
-- net-new SECDEF RPC 1종 제거 (멱등). ADDITIVE 의 역연산 = DROP FN.
--   · fn_selfcheckin_prior_visit 는 net-new(다른 오브젝트 의존 없음) → DROP 안전.
--   · DROP 시 GRANT/REVOKE ACL 동반 소멸. 회귀 0 (기존 anon SELECT 정책 미변경이므로
--     롤백 후 FE 가 구경로(직접 SELECT)로 회귀해도 동작 — 단 FE 배포와 페어링 필요).
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.fn_selfcheckin_prior_visit(UUID, UUID);

COMMIT;
