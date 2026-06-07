-- Rollback: T-20260607-foot-THERAPIST-STATS RPC 2종 + 보강 인덱스 제거.
-- 비파괴 (함수/인덱스 DROP 만). 테이블/데이터 영향 0.
DROP FUNCTION IF EXISTS foot_stats_therapist_services(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS foot_stats_therapist_summary(UUID, DATE, DATE);
DROP INDEX IF EXISTS idx_status_transitions_checkin_tostatus;
