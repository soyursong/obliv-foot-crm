-- Rollback: T-20260612-foot-MEDLAW22-A-CHART-AUDIT / medical_charts_audit_log
-- 본문 감사 트리거 + 함수 + 테이블 제거.
-- 트리거는 RETURN NEW 만 수행(저장 페이로드 무변형)하므로 제거 시에도 진료차트 저장은 무중단.
-- ⚠️ 감사로그 데이터(보존된 수정이력)도 함께 소멸 — 롤백 전 의료법 보존 의무 재확인 필요.

BEGIN;

DROP TRIGGER IF EXISTS trg_medical_charts_body_audit ON medical_charts;
DROP FUNCTION IF EXISTS medical_charts_body_audit();

DROP POLICY IF EXISTS "mcal_select_approved" ON medical_charts_audit_log;
DROP POLICY IF EXISTS "mcal_insert_approved" ON medical_charts_audit_log;

DROP INDEX IF EXISTS idx_mcal_clinic_date;
DROP INDEX IF EXISTS idx_mcal_chart_id;

DROP TABLE IF EXISTS medical_charts_audit_log;

COMMIT;
