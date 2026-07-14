-- ============================================================================
-- T-20260714-foot-ANON-WRITE-SWEEP-REVOKE · ROLLBACK (= anon write GRANT 복원)
--
-- up.sql 의 역: anon write table-grant + write-only ALTER DEFAULT + payment_audit_logs_open
--   을 Supabase fork 기본값(GRANT ALL to anon / permissive ALL TO PUBLIC)으로 복원한다.
--   REVOKE=가역 tightening 이므로 롤백은 '느슨한 기본값으로 되돌리기' 방향(파손 위험 없음).
--
-- ⚠ 정직성 노트: 본 rollback 은 public 전 base 테이블에 anon write 를 GRANT 복원한다.
--   up 직전 상태에서 anon write 를 보유하지 않던 소수 테이블(prod 123 중 ~8)에도 GRANT
--   하므로 '엄밀 역'이 아니라 'fork 기본값 복원'이다. 롤백 의도(권한 loosen)에 부합하고
--   앱 동선 파손 0 이므로 의도적으로 이 방향을 택한다. GRANT 자연 멱등, 데이터 mutation 0.
-- ============================================================================

BEGIN;

DO $restore$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    EXECUTE format('GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.%I TO anon', r.relname);
  END LOOP;
END $restore$;

-- write-only ALTER DEFAULT 복원(미래 테이블 anon write 기본값 재부여)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO anon;

-- payment_audit_logs_open 복원(up 의 AC-2 역 = permissive ALL TO PUBLIC).
DROP POLICY IF EXISTS payment_audit_logs_open ON public.payment_audit_logs;
CREATE POLICY payment_audit_logs_open ON public.payment_audit_logs
  FOR ALL USING (true) WITH CHECK (true);

COMMIT;
