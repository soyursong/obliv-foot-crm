-- ============================================================================
-- T-20260715-foot-STATS-RPC-ANON-EXEC-REVOKE-SWEEP · Batch1 · ROLLBACK
--   (= anon/PUBLIC EXECUTE grant 복원)
--
-- up.sql 의 역: REVOKE 한 함수군의 anon/PUBLIC EXECUTE + function default privilege 를
--   Supabase fork 기본값(GRANT EXECUTE TO PUBLIC)으로 되돌린다. REVOKE=가역 tightening
--   이므로 롤백은 '느슨한 기본값으로 복원'(파손 위험 없음) 방향.
--
-- ⚠ 정직성 노트: 본 rollback 은 KEEP 32 를 제외한 public 전 함수에 EXECUTE 를 PUBLIC/anon
--   으로 GRANT 복원한다. up 직전 anon-exec 이 아니던 소수 함수(141 중 ~16)에도 GRANT
--   하므로 '엄밀 역'이 아니라 'fork 기본값 복원'이다. 롤백 의도(권한 loosen)에 부합하고
--   앱 동선 파손 0(GRANT 자연 멱등, 데이터 mutation 0)이므로 의도적으로 이 방향을 택한다.
--   KEEP 32 는 up 이 무접촉이었으므로 rollback 도 무접촉(중복 grant 방지).
-- ============================================================================

BEGIN;

DO $restore$
DECLARE
  r record;
  keep_names text[] := ARRAY[
    'fn_health_q_validate_token','fn_health_q_submit',
    'fn_prescreen_start','fn_complete_prescreen_checklist',
    'self_checkin_create','self_checkin_lookup','self_checkin_with_reservation_link',
    'fn_selfcheckin_create_check_in','fn_selfcheckin_create_health_q_token',
    'fn_selfcheckin_dup_guard','fn_selfcheckin_existing_checkin_today',
    'fn_selfcheckin_find_customer','fn_selfcheckin_linked_checkin',
    'fn_selfcheckin_match_reservation','fn_selfcheckin_reservation_banner',
    'fn_selfcheckin_rrn_match','fn_selfcheckin_today_reservations',
    'fn_selfcheckin_update_personal_info','fn_selfcheckin_upsert_customer',
    'fn_selfcheckin_upsert_customer_resolve_v2','fn_selfcheckin_upsert_customer_resolve_v3',
    'fn_health_q_create_token','fn_dashboard_reissue_health_q_token',
    'upsert_reservation_from_source',
    'batch_checkin','reservation_to_checkin','fn_reservation_dup_guard',
    'next_queue_number','get_today_reservations','find_customer_by_phone',
    'get_or_create_unified_customer_id','fn_check_in_slot_dwell'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT (p.proname = ANY(keep_names))
    ORDER BY p.proname
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);
  END LOOP;
END $restore$;

-- function default privilege 복원(fork 기본값 = PUBLIC EXECUTE).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon;
-- up 이 추가한 authenticated/service_role 명시 default 는 PUBLIC 복원 시 잉여(무해)이나
-- 대칭성 위해 회수(PUBLIC 이 다시 커버). 미회수해도 앱 동선 무영향.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM authenticated, service_role;

COMMIT;
