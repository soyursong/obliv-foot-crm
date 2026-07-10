BEGIN;

-- ── 1) 신규 상속 차단 (future functions, postgres 창조 경로) ──
--    PUBLIC 기본부여 + anon 명시부여 모두 제거. authenticated/service_role 기본부여는 유지(무접촉).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- ── 2) 소급 회수 (existing functions) ──
--    PUBLIC(anon 의 실질 상속 경로) + anon 명시부여 회수. authenticated/service_role 명시부여는 무접촉→생존.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- ── 3) 화이트리스트 재부여 (AC1 확정 14개, 정확 시그니처) ──
-- A. 공개/셀프서비스 RPC (12)
GRANT EXECUTE ON FUNCTION public.fn_health_q_submit(text, jsonb, text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_health_q_validate_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_prescreen_start(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_complete_prescreen_checklist(uuid, jsonb, text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_create_health_q_token(uuid, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_dup_guard(uuid, uuid, text, date) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_reservation_banner(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_rrn_match(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_today_reservations(uuid, date) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_update_personal_info(uuid, uuid, text, text, text, text, boolean, boolean, text, text, boolean, timestamp with time zone, text) TO anon;
GRANT EXECUTE ON FUNCTION public.self_checkin_with_reservation_link(uuid, jsonb, date) TO anon;
GRANT EXECUTE ON FUNCTION public.next_queue_number(uuid, date) TO anon;
-- B. anon-평가 {public}/{anon} RLS 정책 헬퍼 (2) — 미재부여 시 anon 직접조회 하드에러
GRANT EXECUTE ON FUNCTION public.is_approved_user() TO anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin_or_manager() TO anon;
DO $$
DECLARE v1 text; v2 text; v3 text; v4 text; v5 text; v6 text;
BEGIN
  SET LOCAL ROLE anon;
  BEGIN PERFORM public.fn_health_q_validate_token('__dummy__'); v1:='EXEC-OK';
  EXCEPTION WHEN insufficient_privilege THEN v1:='DENIED-42501(FAIL)'; WHEN OTHERS THEN v1:='EXEC-OK(logic '||SQLSTATE||')'; END;
  BEGIN PERFORM public.next_queue_number('00000000-0000-0000-0000-000000000000'::uuid, current_date); v2:='EXEC-OK';
  EXCEPTION WHEN insufficient_privilege THEN v2:='DENIED-42501(FAIL)'; WHEN OTHERS THEN v2:='EXEC-OK(logic '||SQLSTATE||')'; END;
  BEGIN PERFORM public.fn_prescreen_start('00000000-0000-0000-0000-000000000000'::uuid); v3:='EXEC-OK';
  EXCEPTION WHEN insufficient_privilege THEN v3:='DENIED-42501(FAIL)'; WHEN OTHERS THEN v3:='EXEC-OK(logic '||SQLSTATE||')'; END;
  BEGIN PERFORM public.is_approved_user(); v4:='EXEC-OK';
  EXCEPTION WHEN insufficient_privilege THEN v4:='DENIED-42501(FAIL)'; WHEN OTHERS THEN v4:='EXEC-OK(logic '||SQLSTATE||')'; END;
  BEGIN EXECUTE 'SELECT public.transfer_package_atomic(NULL,NULL,NULL,NULL,NULL)'; v5:='EXEC-OK(FAIL-open)';
  EXCEPTION WHEN insufficient_privilege THEN v5:='DENIED-42501(PASS=봉합)'; WHEN undefined_function THEN v5:='42883-sigmismatch'; WHEN OTHERS THEN v5:='OTHER '||SQLSTATE||'(FAIL)'; END;
  BEGIN EXECUTE 'SELECT public.get_customer_packages(NULL::uuid)'; v6:='EXEC-OK(FAIL-open)';
  EXCEPTION WHEN insufficient_privilege THEN v6:='DENIED-42501(PASS)'; WHEN undefined_function THEN v6:='42883-sigmismatch'; WHEN OTHERS THEN v6:='OTHER '||SQLSTATE||'(FAIL)'; END;
  RESET ROLE;
  RAISE NOTICE 'RESULT % | % | % | % | % | %', v1,v2,v3,v4,v5,v6;
  DROP TABLE IF EXISTS _e2e; CREATE TEMP TABLE _e2e AS
    SELECT * FROM (VALUES
      ('WL-문진: fn_health_q_validate_token', v1),
      ('WL-체크인: next_queue_number', v2),
      ('WL-사전문진: fn_prescreen_start', v3),
      ('WL-RLS헬퍼: is_approved_user', v4),
      ('TierA-돈: transfer_package_atomic', v5),
      ('TierB-조회: get_customer_packages', v6)) t(flow, verdict);
END $$;
SELECT json_agg(row_to_json(_e2e)) AS functional_e2e FROM _e2e;
ROLLBACK;
