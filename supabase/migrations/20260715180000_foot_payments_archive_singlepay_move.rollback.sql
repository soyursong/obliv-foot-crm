-- ROLLBACK — T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR
-- payments_archive 스냅샷 테이블 DROP (up 마이그레이션 역).
--
-- ⚠ 순서 주의: 데이터 MOVE 를 apply 한 상태라면, 먼저 apply 스크립트의 데이터 rollback
--   (package_payments DELETE + payments 복원 + paid_amount 원복 + f48cb162 원복)을 수행해
--   archive 의 original_row 로 payments 를 복원한 뒤에 본 DROP 을 실행할 것.
--   archive 를 먼저 DROP 하면 복원 원본이 소실됨(순소실0 봉투 위반).
--
-- 데이터 rollback 이 선행된(또는 apply 미실행) 상태에서만 안전하게 DROP.

BEGIN;

DROP INDEX IF EXISTS public.idx_payments_archive_ticket;
DROP INDEX IF EXISTS public.idx_payments_archive_original_id;
DROP TABLE IF EXISTS public.payments_archive;

COMMIT;
