-- ROLLBACK: 20260529000000_health_q_mobile.sql
-- T-20260529-foot-HEALTH-Q-MOBILE

DROP FUNCTION IF EXISTS fn_health_q_create_token(UUID, UUID, TEXT, UUID, INT);
DROP FUNCTION IF EXISTS fn_health_q_submit(TEXT, JSONB, TEXT);
DROP FUNCTION IF EXISTS fn_health_q_validate_token(TEXT);
DROP TABLE IF EXISTS health_q_results;
DROP TABLE IF EXISTS health_q_tokens;
