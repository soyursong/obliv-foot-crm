-- ROLLBACK: 20260807180000_foot_reservations_is_trial_marker.sql
-- T-20260807-foot-CONSULTASSIGN-TRIAL-EXCL-CHART2
-- ADDITIVE 역(대칭): 추가한 nullable-default 컬럼 1개만 DROP. 기존 컬럼/행/제약 무접촉.
--   DROP COLUMN 후 회귀 안전: write-path(예약 create/edit)는 payload 에 is_trial 미포함 시 정상 INSERT(FE 는
--   PGRST204/42703 내성 재시도 보유), 소비자(Stream A 조인 / Stream B 파생)는 컬럼 부재 시 COALESCE(false)
--   폴백(전건 비-체험단으로 간주) → 제외 0 · [체험단] 카테고리 0건. 원장·매출·배정 로직 무손상.

BEGIN;

ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS is_trial;

COMMIT;
