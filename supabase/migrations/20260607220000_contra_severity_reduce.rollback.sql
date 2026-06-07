-- 롤백 — T-20260607-foot-CONTRAINDICATION-MGMT AC-3 심각도 enum 축소
--
-- CHECK 제약만 제거하여 자유 TEXT 입력을 복구한다.
-- ⚠️ STEP 1 리매핑(2값 外 → '금기')은 비복원: 원본 값('경고' 등) 복원 불가.
--    필요 시 적용 전 distribution.sql 백업 CSV 로부터 수동 복원.

ALTER TABLE prescription_contraindications
  DROP CONSTRAINT IF EXISTS chk_contra_severity_2val;
