-- T-20260710-foot-SECDEF-ANON-REVOKE  (parent T-20260710-ops-SECDEF-ANON-EXECUTE-GRANT-HYGIENE, AC1 DA GO)
-- 계약 §15-5 (SECURITY DEFINER 함수 EXECUTE anon 최소권한 = default-deny + allowlist) / §16-3c / §1-8
-- foot = 레퍼런스 구현(§21-3 형제 CRM crm/derm/body/scalp/women 전수 승계 템플릿).
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ★★ 프로드 실측으로 발견된 AC2 템플릿 정정 (반드시 읽을 것) ★★
-- ══════════════════════════════════════════════════════════════════════════════
-- 티켓 AC2 원안: "REVOKE EXECUTE ... FROM anon" + "PUBLIC/authenticated 절대 무접촉".
-- 프로드(rxlomoozakkjesdqjtvd) 실측 proacl 결과, 이 원안은 **NO-OP(무효)**이다:
--
--   pg_proc.proacl 실측 (전 함수 공통 패턴):
--     =X/postgres | postgres=X | anon=X | authenticated=X | service_role=X
--     └ 맨 앞 "=X/postgres" = PUBLIC 에 EXECUTE 부여(Postgres CREATE FUNCTION 표준 기본값).
--
--   anon 은 PUBLIC 의 멤버 → anon 의 명시 grant 만 REVOKE 해도 PUBLIC 경로로 EXECUTE 잔존.
--   [실측 증명, 롤백 tx] REVOKE EXECUTE ... FROM anon 후:
--       has_function_privilege('anon','transfer_package_atomic','EXECUTE') = TRUE  ← 여전히 실행 가능(무효)
--   [실측 증명, 롤백 tx] REVOKE EXECUTE ... FROM PUBLIC, anon 후:
--       anon=FALSE / authenticated=TRUE / service_role=TRUE  ← anon 만 차단, 나머지 무접촉 유지
--
-- 결론: §15-5 "default-deny(anon)"를 실제로 달성하려면 PUBLIC 경로를 반드시 회수해야 한다.
--   authenticated/service_role 은 각자 **명시 grant** 를 보유하므로 PUBLIC 회수에도 무접촉으로 생존
--   → AC2 가 우려한 "연쇄 파괴"는 발생하지 않음(실측 검증). AC2 의 의도(스태프/EF 무접촉)는 그대로 보존.
--   → 본 마이그는 AC2 문자(PUBLIC 무접촉)를 정정하되 AC2 안전목표(authenticated/service_role 보존)는 준수.
--   → planner FOLLOWUP 로 이 정정을 보고, supervisor DB-GATE(proacl 3자 대조)로 비준받는다.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 화이트리스트 확정 (AC1, guardrail §1-8) — 증거기반 14개
-- ══════════════════════════════════════════════════════════════════════════════
-- anon(비로그인) 이 실제 호출/평가하는 함수만 재부여. 근거:
--
--  A. 공개/셀프서비스 RPC (anon 클라이언트 직접 .rpc 호출) — 12개
--     · in-repo 익명 페이지 (App.tsx: /health-q/:token, /checklist/:checkInId):
--         fn_health_q_submit / fn_health_q_validate_token          (HealthQMobilePage)
--         fn_prescreen_start / fn_complete_prescreen_checklist      (TabletChecklistPage, anonClient.rpc)
--     · 외부 셀프체크인 앱 (github soyursong/foot-checkin, foot-checkin.pages.dev, anon key, HEAD 2026-07-10):
--         fn_selfcheckin_create_health_q_token / fn_selfcheckin_dup_guard /
--         fn_selfcheckin_reservation_banner / fn_selfcheckin_rrn_match /
--         fn_selfcheckin_today_reservations / fn_selfcheckin_update_personal_info /
--         self_checkin_with_reservation_link / next_queue_number
--       (앱 소스 전수 grep 확정. 나머지 fn_selfcheckin_* / self_checkin_create/lookup / create_check_in /
--        batch_checkin / reservation_to_checkin 등은 앱 직접호출 0 → SECURITY DEFINER 내부 체이닝(definer=postgres
--        컨텍스트, anon EXECUTE 불요) 또는 레거시 → 회수 대상.)
--
--  B. anon 이 평가하는 RLS 정책({public}/{anon} 스코프)이 직접 호출하는 헬퍼 — 2개
--       is_approved_user() , current_user_is_admin_or_manager()
--     · 근거: pg_policies 전수(343개) 중 roles∈{public,anon} 정책(63개)이 직접 참조하는 §119-함수는
--       이 2개뿐(예: health_q_tokens/health_q_results/clinic_events/daily_closings 의 {public} 정책).
--     · anon 직접 .from() 조회 시 {public} 정책식이 평가됨 → 이 2함수 EXECUTE 없으면
--       'permission denied for function' 하드에러(빈결과가 아님) = 셀프서비스 파손.
--       ★ EXECUTE 권한은 SECURITY DEFINER 여부와 무관하게 항상 호출자(anon) 기준 검사되므로 재부여 필수.
--     · 두 함수 모두 opaque boolean 반환(PHI-0), anon 에겐 false 평가(auth.uid() null) → guardrail 통과.
--
--  ※ trigger 함수(set_updated_at, moddatetime_updated_at, handle_new_user, assign_foot_customer_chart_number,
--    normalize_phone 파생 등)는 **회수 대상**: 트리거 발화 시점에는 호출자 EXECUTE 권한을 검사하지 않음
--    (Postgres: EXECUTE 검사는 CREATE TRIGGER 시점 1회). anon INSERT(customers/check_ins/checklists 등) 무영향.
--  ※ anon-writable 테이블의 컬럼 DEFAULT/생성열/CHECK 제약 → §119-함수 참조 0건(실측) → 회수 안전.
--  ※ Tier-A 돈-함수(transfer_package_atomic·consume_package_sessions_for_checkin·refund_package_atomic·
--    calc_refund_amount·get_package_remaining·refund_single_payment·deduct_session_atomic 등)는 어떤 공개
--    흐름도 호출 안 함 → 회수 = RLS-우회 표면 봉합(§15-5-2 Tier-A, 본 마이그의 핵심 보안 이득).
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 실측 검증 (전체 마이그를 BEGIN..ROLLBACK 로 dry-run, Management API 2026-07-10)
-- ══════════════════════════════════════════════════════════════════════════════
--   anon EXECUTE 가능 함수 수: 119 → 14 (화이트리스트만)
--   anon  transfer_package_atomic(Tier-A) = FALSE  (홀 봉합)
--   anon  get_customer_packages(비WL)      = FALSE
--   anon  next_queue_number / is_approved_user / fn_health_q_submit (WL) = TRUE
--   authenticated transfer_package_atomic  = TRUE   (스태프 무접촉)
--   service_role  transfer_package_atomic  = TRUE   (Edge Function 무접촉)
--   authenticated get_customer_packages    = TRUE   (스태프 무접촉)
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 잔여 항목 (supervisor DB-GATE 처리) — 신규-상속 차단의 supabase_admin 축
-- ══════════════════════════════════════════════════════════════════════════════
--   pg_default_acl 실측: 함수 default 부여자 role 2종 = {postgres, supabase_admin}.
--   본 마이그는 postgres 창조 경로만 ALTER DEFAULT PRIVILEGES 로 하드닝(아래).
--   supabase_admin 창조 경로는 postgres 가 변경 불가(ERROR 42501 permission denied 실측) →
--   supervisor(상위권한/대시보드 SQL)가 아래 1줄을 별도 실행 요망:
--     ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
--       REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
--   (실무상 앱/마이그 함수는 전부 postgres 창조 → 급성 리스크 아님. 완결성 위해 명시.)
--
-- 멱등: REVOKE/GRANT 는 자연 멱등(반복 적용 무해). ALTER DEFAULT PRIVILEGES 도 멱등.
-- 데이터 무변경(권한 메타 proacl 만). 가역(rollback SQL 동봉).
-- 적용: ★supervisor DB-GATE(proacl 3자 대조 + 화이트리스트 정확 sig + Tier-A anon 무호출 증거 + staging E2E) 후에만.
-- Rollback: 20260710223000_secdef_anon_execute_revoke_allowlist.rollback.sql

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

COMMIT;

-- 검증 쿼리 (apply 후 supervisor 수동 확인 / proacl 3자 대조):
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--     WHERE n.nspname='public' AND has_function_privilege('anon',p.oid,'EXECUTE');   -- 기대: 14
--   SELECT has_function_privilege('anon','public.transfer_package_atomic(uuid,uuid)','EXECUTE');       -- 기대: false
--   SELECT has_function_privilege('authenticated','public.transfer_package_atomic(uuid,uuid)','EXECUTE'); -- 기대: true
--   SELECT has_function_privilege('service_role','public.transfer_package_atomic(uuid,uuid)','EXECUTE');  -- 기대: true
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--     WHERE n.nspname='public' AND has_function_privilege('anon',p.oid,'EXECUTE') ORDER BY 1;  -- 기대: 화이트리스트 14개
