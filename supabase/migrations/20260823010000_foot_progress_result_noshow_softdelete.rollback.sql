-- Rollback — T-20260822-foot-PROGANALYSIS-RESULT-UPLOAD-LINK (AC-5) §6 노쇼 소프트삭제 RPC
--   함수만 제거(ADDITIVE 역연산). 부모 스키마(slips/images soft-delete 컬럼·트리거)는 무접촉.
--   ★FIX(2026-08-23): 시그니처 변경 반영 — (uuid[]) 단일. 구 시그니처(uuid,date,integer)도 방어적 DROP(멱등).
--   이미 soft-delete 된 이미지 행은 되돌리지 않음(데이터 무손실 — 필요 시 deleted_at=NULL UPDATE 로 수동 복구).
BEGIN;
DROP FUNCTION IF EXISTS public.foot_progress_noshow_softdelete(uuid[]);
-- 구(NO-GO) 시그니처 잔존 방어 — 미착지였으므로 통상 부재(멱등).
DROP FUNCTION IF EXISTS public.foot_progress_noshow_softdelete(uuid, date, integer);
COMMIT;
