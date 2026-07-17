-- ============================================================================
-- T-20260716-foot-SELFCHECKIN-ANON-EXEC-BATCH2-REVOKE · Batch2 · ROLLBACK
--   (= REVOKE 대상 10 self-checkin 함수의 anon/PUBLIC EXECUTE grant 복원)
--
-- up.sql 의 역: REVOKE 한 10 함수의 anon + PUBLIC EXECUTE 를 복원한다.
--   REVOKE=가역 tightening 이므로 롤백은 '느슨한 상태로 복원'(파손 위험 없음) 방향.
--   Batch1 과 달리 Batch2 는 스코프가 정확히 10 함수뿐 → 롤백도 그 10 이름만 접촉
--   (스키마 전체 무접촉, KEEP-7 무접촉).
--
-- ⚠ 정직성 노트: self_checkin_create / self_checkin_lookup 은 up 직전 acl 에 PUBLIC
--   grant 가 없었다(anon=X 단독). 본 롤백은 대칭성/단순성을 위해 이 2함수에도 PUBLIC
--   을 GRANT 복원하므로 '엄밀 역'이 아니라 '살짝 더 느슨한 복원'이다. anon EXECUTE
--   복원(기능 복구의 본질)은 정확히 달성되고, 앱 동선 파손 0(GRANT 자연 멱등, 데이터
--   mutation 0)이므로 의도적으로 이 방향을 택한다. authenticated/service_role grant 는
--   up 이전에도 보유했으므로 무접촉(유지).
-- ============================================================================

BEGIN;

DO $restore$
DECLARE
  r record;
  revoke_names text[] := ARRAY[
    'self_checkin_create','self_checkin_lookup','fn_selfcheckin_create_check_in',
    'fn_selfcheckin_existing_checkin_today','fn_selfcheckin_find_customer',
    'fn_selfcheckin_linked_checkin','fn_selfcheckin_match_reservation',
    'fn_selfcheckin_upsert_customer','fn_selfcheckin_upsert_customer_resolve_v2',
    'fn_selfcheckin_upsert_customer_resolve_v3'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(revoke_names)
    ORDER BY p.proname
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);
  END LOOP;
END $restore$;

COMMIT;
