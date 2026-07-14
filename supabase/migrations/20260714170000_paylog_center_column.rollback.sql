-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260714-foot-REDPAY-DOHSU-CLOSING-POLLER (center 컬럼)
-- ══════════════════════════════════════════════════════════════════
-- 역연산 = 인덱스/CHECK 제약/center 컬럼 DROP.
-- 데이터 손실 = center 컬럼 값만(멀티센터 스코핑 파생값). 기존 recon 이벤트 원장 무접촉.
-- 주의: 롤백 후 EF(redpay-reconcile) 가 center 를 INSERT 하려 하면 컬럼 부재로 오류 →
--   center-aware EF 는 이 컬럼에 의존. 롤백 시 EF 도 center 미참조 버전으로 함께 되돌릴 것.
-- ══════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS public.recon_log_clinic_center_created_idx;

ALTER TABLE public.payment_reconciliation_log
  DROP CONSTRAINT IF EXISTS payment_reconciliation_log_center_check;

ALTER TABLE public.payment_reconciliation_log
  DROP COLUMN IF EXISTS center;

-- 원장 되돌림
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260714170000';
