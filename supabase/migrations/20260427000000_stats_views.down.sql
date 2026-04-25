-- foot-047 ROLLBACK: drop all 8 stats views
DROP VIEW IF EXISTS v_monthly_consultant_perf CASCADE;
DROP VIEW IF EXISTS v_monthly_therapist_perf  CASCADE;
DROP VIEW IF EXISTS v_daily_visit_rate        CASCADE;
DROP VIEW IF EXISTS v_daily_avg_spend         CASCADE;
DROP VIEW IF EXISTS v_daily_stay_duration     CASCADE;
DROP VIEW IF EXISTS v_daily_consult_wait      CASCADE;
DROP VIEW IF EXISTS v_daily_revenue           CASCADE;
DROP VIEW IF EXISTS v_daily_visits            CASCADE;
