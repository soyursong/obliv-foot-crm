-- ROLLBACK: T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT — axis A
--   요양기관명 전용 축 컬럼 제거. ADDITIVE 였으므로 DROP COLUMN 으로 완전 원복(회귀 0).
--   FE 는 {{hira_institution_name}} 바인딩이 공란(affirmative)으로 폴백 없이 렌더되므로
--   컬럼 제거 후에도 요양기관명 셀은 빈칸(사업자상호로 silent 복귀하지 않음).
--   ⚠ 코드 롤백(요양기관명 셀 {{clinic_name}} 환원)이 필요하면 앱 배포도 함께 revert.
BEGIN;

ALTER TABLE public.clinics
  DROP COLUMN IF EXISTS hira_institution_name;

COMMIT;
