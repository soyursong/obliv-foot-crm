-- Rollback: T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK (구조 lane, 전부 ADDITIVE 역)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- ⚠ 롤백 전제: package_credit_ledger / package_amendments 에 백필/운영 데이터가 없어야 함(0-row).
--   데이터가 이미 적재된 뒤 롤백 시 credit 권위 소실 → 롤백 대신 forward-fix 권장.
-- ⚠ FE 가 신규 구조(superseded_by / ledger)를 소비하기 시작한 뒤라면 FE 도 함께 되돌려야 함.

BEGIN;

-- SECTION 5 역: balance 헬퍼 제거
DROP FUNCTION IF EXISTS public.package_credit_balance(UUID, TEXT);

-- SECTION 4 역: amendments 테이블 제거(0-row 전제)
DROP TABLE IF EXISTS public.package_amendments;

-- SECTION 3 역: credit ledger 테이블 제거(0-row 전제)
DROP TABLE IF EXISTS public.package_credit_ledger;

-- SECTION 2 역: superseded_by 컬럼 제거
DROP INDEX IF EXISTS public.idx_packages_superseded_by;
ALTER TABLE public.packages DROP COLUMN IF EXISTS superseded_by;

-- SECTION 1 역: payments.package_id 제거
DROP INDEX IF EXISTS public.idx_payments_package;
ALTER TABLE public.payments DROP COLUMN IF EXISTS package_id;

COMMIT;
