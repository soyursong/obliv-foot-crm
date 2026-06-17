-- ROLLBACK — T-20260617-foot-AUTOASSIGN-BALANCE-TOSS (20260618120000_assignment_autoassign.sql)
--
-- ADDITIVE 2건 제거. 데이터 손실 영향:
--   - assignment_actions DROP: 자동배정/토스/당김 이력 전부 소실(audit). rollback 전 백업 권장.
--   - customers.assigned_consultant_id DROP: 담당 실장 지정분 소실(NULL fallback 으로 복귀).
--   ※ check_ins.consultant_id/therapist_id 는 기존 컬럼(미접촉) — 배정 결과 자체는 보존됨.
--   ※ designated_therapist_id(T-20260522) 미접촉.

BEGIN;

DROP TABLE IF EXISTS assignment_actions;

ALTER TABLE customers
  DROP COLUMN IF EXISTS assigned_consultant_id;

COMMIT;
