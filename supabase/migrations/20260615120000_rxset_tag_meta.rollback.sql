-- ROLLBACK — T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER (20260615120000_rxset_tag_meta.sql)
-- ADDITIVE 3컬럼 제거. nullable·태그미사용 시 전부 NULL이므로 데이터 손실 영향 미미(태그 부여분만 소실).
-- ⚠ 적용 후 현장이 태그를 부여했다면 rollback 시 그 라벨/색/아이콘은 소실됨 → rollback 전 백업 권장.

BEGIN;

ALTER TABLE prescription_sets
  DROP COLUMN IF EXISTS tag_label,
  DROP COLUMN IF EXISTS tag_color,
  DROP COLUMN IF EXISTS icon;

COMMIT;
