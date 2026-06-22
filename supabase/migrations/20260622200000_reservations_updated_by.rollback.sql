-- ROLLBACK: T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI
-- reservations.updated_by 컬럼 제거. ADDITIVE 역연산 — 기존 데이터 무손실(컬럼 자체만 DROP).
-- ⚠ 앱에서 담당자 표시가 created_by-only fallback 으로 회귀하므로 코드 롤백과 함께 적용 권장.

BEGIN;

ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS updated_by;

COMMIT;
