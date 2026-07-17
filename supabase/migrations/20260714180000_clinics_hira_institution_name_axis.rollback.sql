-- ROLLBACK T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT (axis A)
-- clinics.hira_institution_name 컬럼 제거 (ADDITIVE 원복 · 무손실).
-- ⚠ 롤백 시 FE 요양기관명 셀 바인딩({{hira_institution_name}})은 공란 렌더 → 코드 롤백 동반 필요.
ALTER TABLE public.clinics
  DROP COLUMN IF EXISTS hira_institution_name;
