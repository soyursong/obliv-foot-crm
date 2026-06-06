-- T-20260606-foot-MEDCHART-RECORDER-NAME AC-1
-- medical_charts 에 기록자(의사) 표시명 영구 저장 컬럼 추가.
-- 사유: 현재 created_by(이메일)만 저장 → 이름은 조회 시점 동적 파생(staffNameMap).
--       의사 계정 삭제/이메일 변경 시 기록자 추적 끊김(의료기록 원칙 소지).
-- 정책: NULL 허용(레거시 행 + 미매칭 backfill 은 NULL 유지, 추정 금지).
--       표시 시 created_by_name 우선, 없으면 기존 recorderName(created_by) 폴백 → 무손실 점진 채택.
ALTER TABLE public.medical_charts
  ADD COLUMN IF NOT EXISTS created_by_name TEXT;

COMMENT ON COLUMN public.medical_charts.created_by_name IS
  'T-20260606-foot-MEDCHART-RECORDER-NAME: 기록 시점 의사 표시명 스냅샷. 신규 저장 시 채움. NULL=레거시/미매칭(폴백 표시).';
