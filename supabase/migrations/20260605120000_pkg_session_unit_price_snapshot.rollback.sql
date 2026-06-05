-- Rollback: T-20260605-foot-SALES-STAFF-DEDUCT-BASIS
--
-- (1) 근본 fix 트리거/함수 제거.
-- (2) backfill 로 정정된 58건 unit_price 원복:
--     기본은 "되돌리지 않음" — backfill 값은 정상 스냅샷(실매출)이므로 유지 권장.
--     만약 완전 원복이 필요하면, 캡처 CSV(rollback/T-20260605-foot-SALES-STAFF-DEDUCT-BASIS_backfill_capture.csv)
--     의 (id, old_unit_price) 로 개별 UPDATE 한다. old_unit_price 가 '0' 인 행은 0 으로,
--     'NULL' 인 행은 NULL 로 복원. (CSV 컬럼: id,session_type,old_unit_price,new_unit_price)
--
--     예시 (psql \copy 로 임시테이블 적재 후 일괄 원복):
--       CREATE TEMP TABLE _bf(id uuid, session_type text, old_unit_price text, new_unit_price numeric);
--       \copy _bf FROM 'rollback/T-20260605-foot-SALES-STAFF-DEDUCT-BASIS_backfill_capture.csv' CSV HEADER;
--       UPDATE package_sessions ps
--         SET unit_price = NULLIF(b.old_unit_price,'NULL')::numeric
--         FROM _bf b WHERE ps.id = b.id;

BEGIN;

DROP TRIGGER IF EXISTS trg_fill_session_unit_price ON public.package_sessions;
DROP FUNCTION IF EXISTS fn_fill_session_unit_price();

COMMIT;
