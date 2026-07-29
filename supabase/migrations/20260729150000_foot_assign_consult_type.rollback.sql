-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN (배정 상담유형 4종 저장모델)
--   (20260729150000_foot_assign_consult_type.sql)
-- ══════════════════════════════════════════════════════════════════
-- 역연산: check_ins 에 추가한 named CHECK + ADDITIVE nullable 1컬럼 DROP.
--   순수 nullable(DEFAULT 없음) 컬럼 제거 → 기존 배정/매출귀속/RLS 무영향.
--   무접촉: consultant_id / customers.assigned_consultant_id / visit_type / payments / assignment_actions.
-- 멱등: DROP CONSTRAINT IF EXISTS → DROP COLUMN IF EXISTS. (제약 먼저 제거해야 컬럼 DROP 안전.)
-- ⚠ 수동 선택된 상담유형(assignment_consult_type) 데이터 소실 — 롤백은 배포 취소 시 한정.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.check_ins DROP CONSTRAINT IF EXISTS chk_check_ins_assignment_consult_type;
ALTER TABLE public.check_ins DROP COLUMN IF EXISTS assignment_consult_type;

COMMIT;
