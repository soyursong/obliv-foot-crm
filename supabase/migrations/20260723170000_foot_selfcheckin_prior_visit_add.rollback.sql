-- ROLLBACK — T-20260723-foot-JONGNO-KIOSK-READPATH-ANON-CUTOVER 착수조건 ①
-- ============================================================================
-- net-new SECDEF RPC 1종 제거 (멱등). ADDITIVE 의 역연산 = DROP FN.
--   · fn_selfcheckin_prior_visit 는 net-new(다른 오브젝트 의존 없음) → DROP 안전.
--   · DROP 시 GRANT/REVOKE ACL 동반 소멸. 회귀 0 (기존 anon SELECT 정책 미변경이므로
--     롤백 후 FE 가 구경로(직접 SELECT)로 회귀해도 동작 — 단 FE 배포와 페어링 필요).
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.fn_selfcheckin_prior_visit(UUID, UUID);

-- ── [FIX-REQUEST 역연산] 재배선 2종의 anon EXECUTE 회수 = 종전(0716 sweep 후) anon 부재 상태 복원 ──
--   함수 자체는 pre-existing(0615) → DROP 아님. ACL 만 원복(REVOKE FROM anon).
--   authenticated EXECUTE 는 보존(0716 sweep 이 GRANT authenticated 유지했던 정본 상태와 동치).
REVOKE EXECUTE ON FUNCTION public.fn_selfcheckin_match_reservation(UUID, UUID, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_selfcheckin_linked_checkin(UUID, UUID) FROM anon;

COMMIT;
