-- ROLLBACK: 20260727120000_foot_stats_consultant_admin_gate.sql
--   T-20260726-foot-CRM-ASSIGN-RANKING-TAB-ADMINLOCK §2 서버게이트 원복.
--   ⚠ 원복 시 실장 매출·랭킹이 다시 모든 승인 직원에게 서버 노출됨(게이트 이전 상태).
--      FE 를 fetchConsultantPerf→foot_stats_consultant(구) 로 되돌린 커밋과 세트로만 롤백.
-- DB   : rxlomoozakkjesdqjtvd
BEGIN;

-- ② 하위 함수 authenticated EXECUTE 복원 (회수 이전 = 20260430100000/20260430110000 GRANT 상태).
GRANT EXECUTE ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) TO authenticated;

-- ① admin-gated 래퍼 제거.
DROP FUNCTION IF EXISTS public.foot_stats_consultant_admin(UUID, DATE, DATE);

COMMIT;
