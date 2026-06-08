-- ============================================================
-- ROLLBACK: T-20260608-foot-MEDCHART-SIGN-AUDIT (Phase 2)
-- ============================================================
-- 주의: 롤백 시 신규행 진료의 강제(트리거)와 변경이력 audit가 제거된다.
--   medical_charts.signing_doctor_* 컬럼 DROP 시 그동안 저장된 진료의 귀속/스냅샷이 소실되므로
--   운영 데이터 적재 후에는 신중히. (개발/더미 단계 롤백 전제)
-- ============================================================

BEGIN;

-- C. 강제 트리거 제거
DROP TRIGGER IF EXISTS trg_enforce_medchart_signing_doctor ON medical_charts;
DROP FUNCTION IF EXISTS enforce_medchart_signing_doctor();

-- B. audit 테이블 제거
DROP TABLE IF EXISTS medical_chart_signer_audit;

-- A. medical_charts 컬럼 제거
DROP INDEX IF EXISTS idx_medical_charts_signing_doctor;
ALTER TABLE medical_charts
  DROP COLUMN IF EXISTS signing_doctor_seal_url,
  DROP COLUMN IF EXISTS signing_doctor_name,
  DROP COLUMN IF EXISTS signing_doctor_id;

COMMIT;
