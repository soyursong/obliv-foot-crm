-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260714-foot-REDPAY-DOHSU-CLOSING-POLLER (도수 body seed)
-- ══════════════════════════════════════════════════════════════════
-- 역연산 = 본 티켓이 seed 한 도수 14-band(domain='body') 행만 DELETE.
-- 데이터 손실 = 도수 화이트리스트 seed 뿐(foot 17-set·원장 무접촉).
-- ⚠ 폴러(REDPAY_DOMAIN=body)는 이 seed 제거 후 하드코딩 DOHSU DEFAULT 로 폴백(생존).
-- ══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.redpay_terminal_registry') IS NULL THEN
    RAISE NOTICE 'redpay_terminal_registry 부재 — 롤백 대상 없음.';
    RETURN;
  END IF;
  DELETE FROM public.redpay_terminal_registry
   WHERE domain = 'body'
     AND merchant_id IN (
       '1777274001',
       '1777275001','1777275002','1777275003','1777275004',
       '1777275005','1777275006','1777275007','1777275008',
       '1777276001','1777276002','1777276003','1777276004','1777276005'
     );
END $$;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260714170100';
