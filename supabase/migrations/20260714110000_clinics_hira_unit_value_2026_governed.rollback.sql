-- ROLLBACK — T-20260713-foot-HIRA-UNIT-VALUE-2026-UPDATE 이슈1 seed
-- 점당단가 2026 seed + 컬럼 default 제거 원복.
-- ⚠ 원복 시 89.4/2024 stale 로 복귀(급여 ~6.9% 과소) — RPC(20260714120000) 원복과 세트로만.
BEGIN;

-- ② 컬럼 default(89.4/2024) 복원
ALTER TABLE clinics ALTER COLUMN hira_unit_value      SET DEFAULT 89.4;
ALTER TABLE clinics ALTER COLUMN hira_unit_value_year SET DEFAULT 2024;

-- ① seed 원복: 2026(95.6) → 2024(89.4) (멱등)
UPDATE clinics
SET hira_unit_value      = 89.4,
    hira_unit_value_year = 2024
WHERE slug IN ('jongno-foot', 'songdo-foot')
  AND (hira_unit_value      IS DISTINCT FROM 89.4
       OR hira_unit_value_year IS DISTINCT FROM 2024);

COMMENT ON COLUMN clinics.hira_unit_value IS '점수당 원 (기본 89.4 — 2024 기준)';
COMMENT ON COLUMN clinics.hira_unit_value_year IS '환산지수 적용 연도';

COMMIT;
