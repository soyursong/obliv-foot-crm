-- ROLLBACK: T-20260606-foot-MEDCHART-RECORDER-NAME AC-1
-- 컬럼 제거 — 신규 저장 코드(payload.created_by_name)가 함께 롤백된 경우에만 실행.
-- ⚠️ 이 컬럼에 backfill/신규저장된 표시명 스냅샷이 영구 삭제됨. 사람 확인 후 실행.
ALTER TABLE public.medical_charts
  DROP COLUMN IF EXISTS created_by_name;
