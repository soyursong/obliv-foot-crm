-- Rollback — T-20260822-foot-PROGANALYSIS-RESULT-UPLOAD-LINK (AC-5) §6 노쇼 소프트삭제 RPC
--   함수만 제거(ADDITIVE 역연산). 부모 스키마(slips/images soft-delete 컬럼·트리거)는 무접촉.
--   이미 soft-delete 된 이미지 행은 되돌리지 않음(데이터 무손실 — 필요 시 deleted_at=NULL UPDATE 로 수동 복구).
BEGIN;
DROP FUNCTION IF EXISTS public.foot_progress_noshow_softdelete(uuid, date, integer);
COMMIT;
