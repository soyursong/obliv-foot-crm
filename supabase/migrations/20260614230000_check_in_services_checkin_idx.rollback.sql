-- ROLLBACK — T-20260614-foot-STATS-SVCDIST-BOXGRID (check_in_services check_in_id idx)
-- DB: rxlomoozakkjesdqjtvd
-- 주의: 이 인덱스를 제거하면 /admin/stats 매출 통계(foot_stats_by_category) 가
--       PostgREST generic plan 에서 다시 57014 statement timeout 으로 회귀한다.
--       회귀 재현이 필요한 경우에만 사용.

BEGIN;

DROP INDEX IF EXISTS idx_check_in_services_check_in;

COMMIT;
