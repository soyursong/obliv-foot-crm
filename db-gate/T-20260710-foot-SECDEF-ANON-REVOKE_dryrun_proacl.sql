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
SELECT json_build_object(
  'anon_exec',          (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('anon',p.oid,'EXECUTE')),
  'authenticated_exec', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('authenticated',p.oid,'EXECUTE')),
  'service_role_exec',  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('service_role',p.oid,'EXECUTE')),
  'postgres_exec',      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('postgres',p.oid,'EXECUTE')),
  'anon_whitelist',     (SELECT json_agg(x ORDER BY x) FROM (SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS x FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('anon',p.oid,'EXECUTE')) s)
) AS after_state;
ROLLBACK;
