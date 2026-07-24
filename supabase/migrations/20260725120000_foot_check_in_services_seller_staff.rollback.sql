-- ROLLBACK — T-20260724-foot-COSMETIC-SELLER-ATTRIB check_in_services.seller_staff_id (DA §롤백 SQL 조건)
--   비파괴: 신규 컬럼/FK/인덱스만 제거. 기존 check_in_services 행/컬럼 무접촉.
--   ⚠ staff/check_ins 등 참조 부모 테이블 DROP 금지. 화장품 라인 자체는 존치(귀속축만 소거).
ALTER TABLE public.check_in_services DROP CONSTRAINT IF EXISTS check_in_services_seller_staff_id_fkey;
DROP INDEX IF EXISTS public.check_in_services_seller_staff_id_idx;
ALTER TABLE public.check_in_services DROP COLUMN IF EXISTS seller_staff_id;
