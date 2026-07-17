-- ============================================================================
-- T-20260716-foot-SELFCHECKIN-ANON-EXEC-BATCH2-REVOKE · Batch2 · UP
--   parent: T-20260715-foot-STATS-RPC-ANON-EXEC-REVOKE-SWEEP (Batch1, 93f77a75).
--   축: self-checkin cluster read/exec 판. ANON-WRITE-SWEEP / SECDEF-ANON-REVOKE 상보.
--
-- ── 근거 (DA CONSULT-REPLY MSG-20260716-204957-dg8b · Batch2 GO) ────────────────
--   Batch1 이 fail-safe KEEP 로 DEFER 했던 self_checkin_* 17 함수를 외부 콜그래프
--   확정 뒤 재분류:
--     · evidence 티켓 EXTKIOSK-RPC-CALLGRAPH-EVIDENCE(done): 외부 키오스크
--       soyursong/foot-checkin(@155753f) read-only clone 콜그래프 → 외부 top-level
--       .rpc() 직접호출 대상 = KEEP-7, 미호출 = REVOKE-eligible 10.
--     · DA 프로드 introspect(read-only, dg8b): 10함수 전건 prod body caller=0
--       (nested caller 0). 외부 top-level 0 + 프로드 nested 0 **교집합** =
--       REVOKE-eligible CONFIRMED.
--   → REVOKE 10 (nowhere-called) / KEEP 7 (외부 키오스크 live top-level, 무접촉).
--
-- ── REVOKE 10 (본 마이그 대상) ─────────────────────────────────────────────────
--   self_checkin_create, self_checkin_lookup, fn_selfcheckin_create_check_in,
--   fn_selfcheckin_existing_checkin_today, fn_selfcheckin_find_customer,
--   fn_selfcheckin_linked_checkin, fn_selfcheckin_match_reservation,
--   fn_selfcheckin_upsert_customer, fn_selfcheckin_upsert_customer_resolve_v2,
--   fn_selfcheckin_upsert_customer_resolve_v3
--   각각: REVOKE EXECUTE FROM anon, PUBLIC + GRANT EXECUTE TO authenticated,
--   service_role (스태프/서비스 경로 보존). 시그니처 오버로드 전수 커버
--   (proname 매칭 동적 sweep → 이름별 모든 proargtypes 자동 포함).
--   실측(prod 2026-07-16): 10 함수 각 1 시그니처(오버로드 0), 8/10 은 acl 에
--   PUBLIC(=X) + anon=X 이중 grant, self_checkin_create/lookup 은 anon=X 단독
--   (PUBLIC 없음 → REVOKE FROM PUBLIC = 무해 no-op).
--
-- ── KEEP 7 (무접촉 · anon EXECUTE 불변) ────────────────────────────────────────
--   self_checkin_with_reservation_link, fn_selfcheckin_reservation_banner,
--   fn_selfcheckin_today_reservations, fn_selfcheckin_dup_guard,
--   fn_selfcheckin_update_personal_info, fn_selfcheckin_rrn_match,
--   fn_selfcheckin_create_health_q_token
--   ⚠ KEEP-7 중 raw name/phone 반환분(reservation_banner·today_reservations 등)의
--     서버측 PHI 마스킹은 masking_pin_ticket T-20260711-foot-SELFCHECKIN-SERVER-MASKING
--     (reopened)에서 승계 추적. durable end-state = KEEP-7 도 PUBLIC REVOKE(anon 유지)
--     까지 → 본 티켓 partial-hardened(closed 금지).
--   ⚠ CRITICAL fn_selfcheckin_verify_reservation 은 프로드 부재(pg_proc=[]) → 본
--     REVOKE 스코프 밖(별건 통보 티켓). 여기서 다루지 않음.
--
-- ── 성격 / 게이트 ──────────────────────────────────────────────────────────────
--   함수 정의/시그니처/컬럼/enum 무변경 = 가역 tightening(파괴 아님). 데이터 mutation 0
--   (권한 메타 acl only). cross-CRM 영향 0(foot-local). 멱등: REVOKE/GRANT 자연 멱등.
--   ALTER DEFAULT PRIVILEGES 는 Batch1 이 이미 처리(재-drift 근본차단) → 본 마이그 미포함.
--   대표 게이트 면제(autonomy §3.1, REVOKE=가역) + supervisor DDL-diff DB-GATE 의무.
--   ★순차: parent Batch1(93f77a75, n_revoked=93 assert) prod 착지 확인 뒤 apply.
-- 롤백: 20260716210000_foot_rpc_anon_exec_hygiene_sweep_batch2.rollback.sql
-- 작성: dev-foot / 2026-07-16
-- ============================================================================

BEGIN;

-- ── (0) PREFLIGHT: REVOKE 대상 10 이름 전건 실재 확인(오적용 방지, 무영속 abort) ──
DO $preflight$
DECLARE
  revoke_names text[] := ARRAY[
    'self_checkin_create','self_checkin_lookup','fn_selfcheckin_create_check_in',
    'fn_selfcheckin_existing_checkin_today','fn_selfcheckin_find_customer',
    'fn_selfcheckin_linked_checkin','fn_selfcheckin_match_reservation',
    'fn_selfcheckin_upsert_customer','fn_selfcheckin_upsert_customer_resolve_v2',
    'fn_selfcheckin_upsert_customer_resolve_v3'
  ];
  n_names int;
BEGIN
  SELECT count(DISTINCT p.proname) INTO n_names
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = ANY(revoke_names);
  IF n_names <> 10 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: expected 10 self-checkin REVOKE-target functions, found % — wrong DB or drift', n_names;
  END IF;
END $preflight$;

-- ── revoked sig 추적 temp (VERIFY 정밀화) ──
CREATE TEMP TABLE _batch2_revoked (sig text) ON COMMIT DROP;

-- ── (1) sweep: REVOKE 대상 10 이름의 모든 시그니처 REVOKE EXECUTE FROM anon, PUBLIC
--        + 스태프/서비스 경로 보장 GRANT EXECUTE TO authenticated, service_role ──
DO $sweep$
DECLARE
  r record;
  revoke_names text[] := ARRAY[
    'self_checkin_create','self_checkin_lookup','fn_selfcheckin_create_check_in',
    'fn_selfcheckin_existing_checkin_today','fn_selfcheckin_find_customer',
    'fn_selfcheckin_linked_checkin','fn_selfcheckin_match_reservation',
    'fn_selfcheckin_upsert_customer','fn_selfcheckin_upsert_customer_resolve_v2',
    'fn_selfcheckin_upsert_customer_resolve_v3'
  ];
  n_revoked int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(revoke_names)   -- proname 매칭 → 오버로드 전수 커버
    ORDER BY p.proname
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
    INSERT INTO _batch2_revoked(sig) VALUES (r.sig::text);
    n_revoked := n_revoked + 1;
  END LOOP;
  RAISE NOTICE 'sweep: self-checkin REVOKE-eligible signatures processed = %', n_revoked;
END $sweep$;

-- ── (2) VERIFY: 착지 확인(실패 시 abort — 무영속) ──
DO $verify$
DECLARE
  revoke_names text[] := ARRAY[
    'self_checkin_create','self_checkin_lookup','fn_selfcheckin_create_check_in',
    'fn_selfcheckin_existing_checkin_today','fn_selfcheckin_find_customer',
    'fn_selfcheckin_linked_checkin','fn_selfcheckin_match_reservation',
    'fn_selfcheckin_upsert_customer','fn_selfcheckin_upsert_customer_resolve_v2',
    'fn_selfcheckin_upsert_customer_resolve_v3'
  ];
  keep_names text[] := ARRAY[
    'self_checkin_with_reservation_link','fn_selfcheckin_reservation_banner',
    'fn_selfcheckin_today_reservations','fn_selfcheckin_dup_guard',
    'fn_selfcheckin_update_personal_info','fn_selfcheckin_rrn_match',
    'fn_selfcheckin_create_health_q_token'
  ];
  n_revoked   int;
  bad_anon    int;
  bad_auth    int;
  keep_remain int;
BEGIN
  -- (0) sweep 처리 시그니처 수 = 10 (실측: 10 이름 각 1 시그니처, 오버로드 0). drift 시 abort.
  SELECT count(*) INTO n_revoked FROM _batch2_revoked;
  IF n_revoked <> 10 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: revoked signatures = % (expected 10). prod drift(신규 오버로드?) vs introspect — 재-CONSULT 필요', n_revoked;
  END IF;

  -- (a) [핵심] REVOKE 대상 10 이름의 anon EXECUTE 잔존 0
  SELECT count(*) INTO bad_anon
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY(revoke_names)
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF bad_anon > 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: % REVOKE-target signatures still grant anon EXECUTE', bad_anon;
  END IF;

  -- (b) REVOKE 대상의 authenticated EXECUTE 보존(스태프 경로 무훼손)
  SELECT count(*) INTO bad_auth
  FROM _batch2_revoked v
  WHERE NOT has_function_privilege('authenticated', v.sig::regprocedure, 'EXECUTE');
  IF bad_auth > 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: % revoked signatures lost authenticated EXECUTE (staff breakage)', bad_auth;
  END IF;

  -- (c) [AC-4] KEEP 7 은 여전히 anon EXECUTE 보유(외부 키오스크 체크인 경로 무파손)
  SELECT count(DISTINCT p.proname) INTO keep_remain
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY(keep_names)
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF keep_remain <> 7 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: KEEP-7 anon EXECUTE 훼손 — only %/7 keep-names retain anon EXECUTE (키오스크 파손 위험)', keep_remain;
  END IF;
END $verify$;

COMMIT;
