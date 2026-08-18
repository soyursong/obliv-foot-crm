-- ROLLBACK: T-20260818-foot-CUSTMGMT-SEARCH-FAIL
--   customers 4-컬럼 검색 trigram GIN 인덱스 원복 = DROP INDEX IF EXISTS ×4 (DA §2 롤백 명세).
--   완전가역·비파괴: 인덱스만 제거, 기존행/컬럼/제약/RLS 무접촉. pg_trgm 확장은 유지
--   (prod 선-설치·다른 후속 사용 가능성 → DROP 안 함). 멱등: IF EXISTS → 재실행 no-op.
--
-- ⚠ CONCURRENTLY 로 생성했으나 DROP INDEX(plain)은 트랜잭션 안팎 모두 가능(빠른 메타 작업).
--    운영 무중단 필요 시 DROP INDEX CONCURRENTLY 로 교체 가능(옵션). 본 명세는 DA 문자 그대로 plain.
-- 적용: node scripts/apply_20260818180000_foot_customers_search_trgm_gin.mjs --rollback
-- ticket: T-20260818-foot-CUSTMGMT-SEARCH-FAIL / author: dev-foot / 2026-08-18

DROP INDEX IF EXISTS public.idx_customers_name_trgm;
DROP INDEX IF EXISTS public.idx_customers_phone_trgm;
DROP INDEX IF EXISTS public.idx_customers_birth_date_trgm;
DROP INDEX IF EXISTS public.idx_customers_chart_number_trgm;

-- 검증(롤백 후): 4 인덱스 부재 확인
--   SELECT count(*) FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid
--     WHERE c.relname LIKE 'idx_customers_%_trgm';   -- expect 0
