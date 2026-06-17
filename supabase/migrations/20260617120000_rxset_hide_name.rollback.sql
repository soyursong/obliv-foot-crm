-- ROLLBACK — T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL (20260617120000_rxset_hide_name.sql)
-- ADDITIVE 1컬럼 제거. nullable·DEFAULT false 이므로 데이터 손실 영향 미미(이름숨김 설정분만 소실).
-- ⚠ 적용 후 현장이 '이름 숨기기'를 켰다면 rollback 시 그 플래그는 소실됨(이름 표시로 복귀) → rollback 전 백업 권장.

BEGIN;

ALTER TABLE prescription_sets
  DROP COLUMN IF EXISTS hide_name;

COMMIT;
