-- ============================================================================
-- T-20260715-foot-STATS-RPC-ANON-EXEC-REVOKE-SWEEP · Batch1 · UP
--   ANON-WRITE-SWEEP(table WRITE grant)의 EXECUTE(RPC read/call) 판.
--   부모: T-20260710-ops-SECDEF-ANON-EXECUTE-GRANT-HYGIENE 라인.
--
-- ── 근거 (DA 재-CONSULT-REPLY, MSG-20260716-171517-bslf = GO_REVISED) ──────────
--   introspect(prod rxlomoozakkjesdqjtvd, 2026-07-16): public 함수 141개 중 125개가
--   anon EXECUTE=TRUE. 125개 전부 acl 에 PUBLIC(=X) + explicit anon(anon=X) 이중 grant
--   → REVOKE FROM anon 단독 불충분, ★PUBLIC 포함 회수 필요(DA #1(b)).
--   fork-wide systemic drift(125/141) 를 2-batch split 로 처리:
--     · Batch1 (본 마이그, GO NOW): (A)staff-only-in-repo + (B)trigger/util no-op = 93함수.
--     · Batch2 (DEFER, 외부 콜그래프 대기): self_checkin 17 + health-Q 토큰발급 2 +
--       upsert_reservation_from_source 1 + (C)flow-adjacent 8 = 28함수 무접촉(KEEP).
--     · allowlist(anonClient 정상경로, 영구 KEEP): 4함수.
--   → KEEP 총 32 / REVOKE 93. (32 + 93 = 125.)
--
-- ── 분류 규칙 (DA 신규) ────────────────────────────────────────────────────────
--   (A) staff-only-in-repo (authenticated supabase 클라이언트만 호출) → Batch1 REVOKE
--   (B) util/trigger no-op (trigger 함수 26개 = 클라이언트 .rpc() 경로 자체가 없음 +
--       순수 helper) → Batch1 REVOKE (무해)
--   (C) check-in·reservation·health-Q flow-adjacent · 외부 anon 키오스크
--       (foot-checkin.pages.dev / soyursong/foot-checkin) 직접호출 개연성 배제불가
--       → Batch2 DEFER (fail-safe KEEP). 예: next_queue_number 는
--       fn_selfcheckin_create_check_in 의 p_queue_number 파라미터 → 키오스크가 선-계산
--       위해 직접 .rpc() 할 개연성 있음.
--
-- ── ★ Batch1 우선착지 이유 (LIVE 노출) ────────────────────────────────────────
--   admin_register_user / admin_reset_user_password / admin_toggle_user_active 는
--   acl 에 anon 명시 grant(PUBLIC 없이도 anon=X) → 현재 비인증 anon 이 계정 register/
--   password reset/활성토글을 EXECUTE 가능한 live 노출. + get_vault_secret(secret 리더)
--   도 anon 실행 가능. Batch1 을 이 이유로 우선 착지.
--
-- ── KEEP 32 (본 마이그 무접촉) ─────────────────────────────────────────────────
--   [allowlist·영구]      fn_health_q_validate_token, fn_health_q_submit,
--                         fn_prescreen_start, fn_complete_prescreen_checklist
--   [Batch2·self-checkin] self_checkin_create, self_checkin_lookup,
--                         self_checkin_with_reservation_link,
--                         fn_selfcheckin_* (14)
--   [Batch2·healthQ토큰]  fn_health_q_create_token, fn_dashboard_reissue_health_q_token
--   [Batch2·ext ingest]   upsert_reservation_from_source
--   [Batch2·(C)flow-adj]  batch_checkin, reservation_to_checkin, fn_reservation_dup_guard,
--                         next_queue_number, get_today_reservations,
--                         find_customer_by_phone, get_or_create_unified_customer_id,
--                         fn_check_in_slot_dwell
--
-- ── ALTER DEFAULT PRIVILEGES (재-drift 근본차단, DA #2) ────────────────────────
--   prod 141/141 함수 owner=postgres 실측 → FOR ROLE postgres 가 re-drift 근원과 일치.
--   REVOKE EXECUTE FROM PUBLIC, anon (신규 함수의 blanket PUBLIC exec 상속 차단) +
--   ★보상 GRANT EXECUTE TO authenticated, service_role (미래 스태프 함수가 default
--   PUBLIC 회수 후에도 무중단 — anon/PUBLIC 만 차단, 스태프 경로 보존).
--   ⚠ 이 보상 GRANT 는 DA #2(REVOKE FROM PUBLIC,anon)의 완성 — supervisor DB-gate 3자
--   대조(pg_default_acl.defaclrole + 대시보드 생성 role introspect)에서 최종 confirm.
--   대시보드 경유 생성 role(supabase_admin 등) default_acl 별도 존재 여부도 그 게이트에서.
--
-- ── 성격 / 게이트 ──────────────────────────────────────────────────────────────
--   함수 정의/시그니처/컬럼/enum 무변경 = 가역 tightening(파괴 아님). 데이터 mutation 0
--   (권한 메타 acl only). cross-CRM 영향 0(foot-local). 멱등: REVOKE/GRANT 자연 멱등.
--   대표 게이트 면제(autonomy §3.1, REVOKE=가역) + supervisor DDL-diff DB-GATE 의무.
--   AC-4: BYCAT-IVEXCLUDE(beb63581) 함수 재정의 배포 뒤 착지(CREATE OR REPLACE 는 ACL
--   보존 → 순서 무해하나 최종상태 anon EXECUTE=0 확인).
-- 롤백: 20260716180000_foot_rpc_anon_exec_hygiene_sweep_batch1.rollback.sql
-- 작성: dev-foot / 2026-07-16
-- ============================================================================

BEGIN;

-- ── (0) PREFLIGHT: foot public 스키마 실재 확인(오적용 방지, 무영속 abort) ──
DO $preflight$
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public'
        AND p.proname IN ('foot_stats_revenue','admin_reset_user_password',
                          'self_checkin_lookup','fn_health_q_validate_token')) < 4 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: expected foot public functions absent — wrong DB?';
  END IF;
END $preflight$;

-- ── revoked oid 추적 temp (VERIFY 정밀화 — 미접촉 non-anon 함수 오판 방지) ──
CREATE TEMP TABLE _batch1_revoked (sig text) ON COMMIT DROP;

-- ── (1) 동적 sweep: KEEP 32 제외 전 anon-exec 함수 REVOKE EXECUTE FROM PUBLIC, anon
--        + 스태프 경로 보장 GRANT EXECUTE TO authenticated, service_role ──
DO $sweep$
DECLARE
  r record;
  keep_names text[] := ARRAY[
    -- allowlist (anonClient 정상경로 · 영구 KEEP)
    'fn_health_q_validate_token','fn_health_q_submit',
    'fn_prescreen_start','fn_complete_prescreen_checklist',
    -- Batch2 · self-checkin cluster (외부 키오스크 소유)
    'self_checkin_create','self_checkin_lookup','self_checkin_with_reservation_link',
    'fn_selfcheckin_create_check_in','fn_selfcheckin_create_health_q_token',
    'fn_selfcheckin_dup_guard','fn_selfcheckin_existing_checkin_today',
    'fn_selfcheckin_find_customer','fn_selfcheckin_linked_checkin',
    'fn_selfcheckin_match_reservation','fn_selfcheckin_reservation_banner',
    'fn_selfcheckin_rrn_match','fn_selfcheckin_today_reservations',
    'fn_selfcheckin_update_personal_info','fn_selfcheckin_upsert_customer',
    'fn_selfcheckin_upsert_customer_resolve_v2','fn_selfcheckin_upsert_customer_resolve_v3',
    -- Batch2 · health-Q 토큰 발급 (키오스크 개연성)
    'fn_health_q_create_token','fn_dashboard_reissue_health_q_token',
    -- Batch2 · 외부 예약연동 ingest
    'upsert_reservation_from_source',
    -- Batch2 · (C) flow-adjacent (키오스크 직접호출 개연성 배제불가)
    'batch_checkin','reservation_to_checkin','fn_reservation_dup_guard',
    'next_queue_number','get_today_reservations','find_customer_by_phone',
    'get_or_create_unified_customer_id','fn_check_in_slot_dwell'
  ];
  n_revoked int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')  -- drift 대상 = 현재 anon-exec
      AND NOT (p.proname = ANY(keep_names))                 -- KEEP 32 제외
    ORDER BY p.proname
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    -- 스태프/서비스 경로 보장(멱등 — 이미 보유). 트리거 함수엔 무해(트리거는 grant 무관 발화).
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
    INSERT INTO _batch1_revoked(sig) VALUES (r.sig::text);
    n_revoked := n_revoked + 1;
  END LOOP;
  RAISE NOTICE 'sweep: REVOKE-eligible functions processed = %', n_revoked;
END $sweep$;

-- ── (2) ALTER DEFAULT PRIVILEGES: 미래 함수 anon/PUBLIC exec 기본값 차단 + 스태프 보존 ──
--   실측(2026-07-16): postgres 'f' default_acl = {postgres=X,anon=X,authenticated=X,
--   service_role=X}(PUBLIC 항목 없음). → REVOKE PUBLIC=no-op, REVOKE anon=anon=X 제거.
--   ⚠ 별도 존재: supabase_admin 'f' default_acl 도 anon=X 부여(대시보드 생성 함수 re-drift
--   벡터). postgres 역할로는 FOR ROLE supabase_admin ALTER 권한 부재 개연 → 본 마이그
--   미포함. DA #2 지정대로 supervisor DB-gate 3자 대조에서 supabase_admin default 처리/
--   confirm(별도 role 로 ALTER 필요 시 supervisor 실행). = 잔여 re-drift 추적 항목.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- ── (3) VERIFY: 착지 확인(실패 시 abort — 무영속) ──
DO $verify$
DECLARE
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
  bad_anon      int;
  bad_auth      int;
  keep_remain   int;
  n_revoked     int;
  bad_def_anon  int;
  bad_def_pub   int;
  ok_def_auth   int;
BEGIN
  -- (0) sweep 처리 건수 = 93 (introspect 기준: 125 anon-exec − 32 KEEP). drift 시 abort.
  SELECT count(*) INTO n_revoked FROM _batch1_revoked;
  IF n_revoked <> 93 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: revoked count = % (expected 93 = 125 anon-exec − 32 KEEP). prod drift vs introspect — 재-CONSULT 필요', n_revoked;
  END IF;

  -- (a) [핵심] KEEP 외 함수에 anon EXECUTE 잔존 0
  SELECT count(*) INTO bad_anon
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT (p.proname = ANY(keep_names))
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF bad_anon > 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: % non-keep public functions still grant anon EXECUTE', bad_anon;
  END IF;

  -- (b) REVOKE 대상(실제 sweep 처리분)의 authenticated EXECUTE 보존(스태프 경로 무훼손).
  --     temp _batch1_revoked 기준 → 미접촉 non-anon 함수(내부 전용 등) 오판 배제.
  SELECT count(*) INTO bad_auth
  FROM _batch1_revoked v
  WHERE NOT has_function_privilege('authenticated', v.sig::regprocedure, 'EXECUTE');
  IF bad_auth > 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: % revoked functions lost authenticated EXECUTE (staff breakage)', bad_auth;
  END IF;

  -- (c) KEEP 32 는 여전히 anon EXECUTE 보유(과잉회수 아님)
  SELECT count(DISTINCT p.proname) INTO keep_remain
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY(keep_names)
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF keep_remain < 32 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: KEEP allowlist over-revoked — only %/32 keep-names retain anon EXECUTE', keep_remain;
  END IF;

  -- (d) ALTER DEFAULT 착지: postgres-owned public function default_acl 상
  --     anon/PUBLIC 부재 + authenticated 보유
  SELECT count(*) INTO bad_def_anon
  FROM pg_default_acl d CROSS JOIN LATERAL unnest(d.defaclacl) AS acl(item)
  WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'f'
    AND d.defaclrole = 'postgres'::regrole AND acl.item::text LIKE 'anon=%';
  SELECT count(*) INTO bad_def_pub
  FROM pg_default_acl d CROSS JOIN LATERAL unnest(d.defaclacl) AS acl(item)
  WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'f'
    AND d.defaclrole = 'postgres'::regrole AND acl.item::text LIKE '=%/%';  -- PUBLIC(빈 grantee)
  SELECT count(*) INTO ok_def_auth
  FROM pg_default_acl d CROSS JOIN LATERAL unnest(d.defaclacl) AS acl(item)
  WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'f'
    AND d.defaclrole = 'postgres'::regrole AND acl.item::text LIKE 'authenticated=%';
  IF bad_def_anon > 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: pg_default_acl(function) still grants anon EXECUTE';
  END IF;
  IF bad_def_pub > 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: pg_default_acl(function) still grants PUBLIC EXECUTE';
  END IF;
  IF ok_def_auth < 1 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: pg_default_acl(function) missing authenticated EXECUTE (staff default broken)';
  END IF;
END $verify$;

COMMIT;
