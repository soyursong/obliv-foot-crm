-- ============================================================
-- ROLLBACK — T-20260701-foot-THERAPIST-SKILL-CAPABILITY-ASSIGN
-- ============================================================
-- therapist_capabilities 제거(순수 신설 → DROP 안전, 다운스트림 FK 없음).
-- 배정 필터(filterTherapistPoolByTreatmentCapability)는 테이블 부재(42P01) 시 graceful no-op
--   (전체 pool 반환) → 롤백 후에도 배정 동선 무중단. capability 설정 UI 는 조회 error 안내만 표시.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS therapist_capabilities;

COMMIT;
