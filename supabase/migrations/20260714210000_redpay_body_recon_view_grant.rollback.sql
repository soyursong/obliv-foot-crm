-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260714-foot-REDPAY-BODY-RECON-VIEW-GRANT (전량 가역)
-- ══════════════════════════════════════════════════════════════════
-- 순서: 뷰 grant 회수 → 뷰 DROP → role 소유권/grant 정리(DROP OWNED) → role DROP → 원장 삭제.
-- base 테이블(payment_reconciliation_log/redpay_raw_transactions/payments) 무접점.
-- 데이터 손실 = 없음(뷰/role 은 파생 객체, base 데이터 무변경).
-- ══════════════════════════════════════════════════════════════════

-- ── 1. 뷰 grant 회수 + 뷰 DROP ──────────────────────────────────────────────
REVOKE ALL ON public.v_redpay_reconciliation_body FROM body_recon_ro;
DROP VIEW IF EXISTS public.v_redpay_reconciliation_body;

-- ── 2. role 정리 + DROP (멱등: 존재 시에만) ─────────────────────────────────
--   DROP OWNED BY: role 에 부여된 모든 grant(스키마 USAGE 등) 제거 → DROP ROLE 의존성 해소.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'body_recon_ro') THEN
    ALTER ROLE body_recon_ro RESET default_transaction_read_only;
    DROP OWNED BY body_recon_ro;   -- 뷰 DROP 후 잔여 grant(schema USAGE 등) 정리
    DROP ROLE body_recon_ro;
  END IF;
END$$;

-- ── 3. 원장 삭제 ────────────────────────────────────────────────────────────
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260714210000';
