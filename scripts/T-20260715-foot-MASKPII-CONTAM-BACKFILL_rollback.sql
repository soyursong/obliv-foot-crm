-- T-20260715-foot-MASKPII-CONTAM-BACKFILL — ROLLBACK (pre-image 복원)
-- 전제: forward(mutation.sql) 가 maskpii_bk_20260715.{customers,check_ins}_preimage 를 생성했음.
-- ⚠ 복원값 = 원래의 '마스킹' 이름(홍*동 형태). customers reject 트리거가 이를 재차 거부하므로
--    복원 구간에서 트리거를 LOCAL 억제한다(rollback = 정정 이전 상태로의 복귀, 정책 예외).
-- ⚠ supervisor DB-GATE 하에서만 실행.

BEGIN;

SET LOCAL session_replication_role = replica;   -- reject 트리거 억제(마스킹 원값 복원 위함) + check_ins 부작용 억제

UPDATE public.customers c
SET name = b.old_name, updated_at = b.old_updated_at
FROM maskpii_bk_20260715.customers_preimage b
WHERE c.id = b.id AND c.name = '[재수집필요]';

UPDATE public.check_ins ci
SET customer_name = b.old_customer_name
FROM maskpii_bk_20260715.check_ins_preimage b
WHERE ci.id = b.id AND ci.customer_name = '[재수집필요]';

SET LOCAL session_replication_role = origin;

COMMIT;

-- 백업 스키마 정리(복원 검증·보존기간 후 supervisor 수동):
-- DROP SCHEMA IF EXISTS maskpii_bk_20260715 CASCADE;
