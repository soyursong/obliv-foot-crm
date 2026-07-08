-- ROLLBACK — T-20260708-foot-PKGSTATS-DIRECTINPUT-TREATTYPE-REFPRICE
-- 전량 ADDITIVE 의 역연산. 신규 컬럼 2 + 신규 테이블 1 제거. 기존 데이터 무손실(신규 요소만 drop).

BEGIN;

DROP FUNCTION IF EXISTS foot_stats_pkg_discount_by_consultant(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS foot_stats_pkg_avg_by_treatment(UUID, DATE, DATE);

DROP TABLE IF EXISTS public.treatment_standard_prices;

ALTER TABLE public.packages DROP COLUMN IF EXISTS reference_price;
-- named CHECK 는 DROP COLUMN 이 cascade 제거하나, 명시 드롭으로 재현성 확보(RECONCILE(C)).
ALTER TABLE public.packages DROP CONSTRAINT IF EXISTS chk_packages_treatment_type;
ALTER TABLE public.packages DROP COLUMN IF EXISTS treatment_type;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260708220000';

COMMIT;
