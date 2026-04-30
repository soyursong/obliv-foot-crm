-- T-20260430-foot-STATS-DASHBOARD 롤백
DROP FUNCTION IF EXISTS foot_stats_revenue(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS foot_stats_by_category(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS foot_stats_consultant(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS foot_stats_noshow_returning(UUID, DATE, DATE);
