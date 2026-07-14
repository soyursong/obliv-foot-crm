-- ROLLBACK T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET #2
-- clinics.representative_name 컬럼 제거 (ADDITIVE 원복).
ALTER TABLE public.clinics
  DROP COLUMN IF EXISTS representative_name;
