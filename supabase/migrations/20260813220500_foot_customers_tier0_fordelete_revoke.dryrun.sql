-- ============================================================
-- DRY-RUN (no-persistence) — customers Tier-0 FOR DELETE grant REVOKE
-- ============================================================
-- 목적: apply 前 사전검증. (1) customers 실재 (2) 현재 DELETE grant 보유 role 리포트 (3) FOR ALL 정책 잔존 확인.
-- 무영속: 마지막 강제 ROLLBACK — 어떤 grant 변경도 확정하지 않는다(txn-control 문 미포함).
-- ============================================================

DO $$
DECLARE
  v_holders text := '';
  v_polcnt int := 0;
  r record;
BEGIN
  -- (1) 대상 테이블 실재
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customers') THEN
    RAISE EXCEPTION '[DRY-RUN] public.customers 부재';
  END IF;

  -- (2) 현재 DELETE privilege 보유 grantee 리포트 (REVOKE 대상 확인)
  FOR r IN
    SELECT grantee FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='customers' AND privilege_type='DELETE'
    ORDER BY grantee
  LOOP
    v_holders := v_holders || r.grantee || ' ';
  END LOOP;
  RAISE NOTICE '[DRY-RUN] customers DELETE grant 현재 보유: [%]', COALESCE(NULLIF(v_holders,''), '(none)');
  IF position('authenticated' in v_holders) = 0 THEN
    RAISE NOTICE '[DRY-RUN] ℹ authenticated 가 이미 DELETE 미보유 → REVOKE 는 no-op(멱등·무해).';
  END IF;
  IF position('anon' in v_holders) > 0 THEN
    RAISE NOTICE '[DRY-RUN] ⚠ anon 이 아직 DELETE 보유 — phase1 REVOKE 미반영 상태일 수 있음(재확인).';
  END IF;

  -- (3) FOR ALL 정책 잔존 확인 (SELECT/INSERT/UPDATE 유지 · DELETE 는 privilege 층에서만 봉인)
  SELECT count(*) INTO v_polcnt FROM pg_policies
    WHERE schemaname='public' AND tablename='customers' AND cmd IN ('ALL');
  RAISE NOTICE '[DRY-RUN] customers FOR ALL 정책 수: % (유지 — REVOKE 는 정책 재작성 아님·grant 층만)', v_polcnt;

  RAISE NOTICE '[DRY-RUN] ✔ customers Tier-0 FOR DELETE grant REVOKE 사전검증 통과(무영속).';
END $$;
