-- Rollback: T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN
-- 배정 상담유형 수동 저장 컬럼 + named CHECK 제거.
-- 롤백 후 배정 초진/재진 분류는 자동 365-recency 축(현행)만 남는다(수동 assertion 저장 소실).
-- ⚠ 컬럼 DROP 은 저장된 수동 선택값을 파괴함 — 롤백 전 데이터 보존 필요 시 export 선행.

BEGIN;

ALTER TABLE public.check_ins
  DROP CONSTRAINT IF EXISTS chk_check_ins_assignment_consult_type;

ALTER TABLE public.check_ins
  DROP COLUMN IF EXISTS assignment_consult_type;

COMMIT;
