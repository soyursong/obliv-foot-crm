-- ============================================================================
-- T-20260810-foot-AUTH-SECDEF-ANON-REVOKE-SEAL · UP
--   SECDEF 2fn(record_auth_action / stamp_auth_action_outcome) + audit 테이블의
--   anon grant-surface 봉인 (canonical §8-B grant-seal 블록 byte-identical).
--   da_consult_ref: DA-20260810-crm-AUTH-ACTOR-AUDIT-SECDEF-ANON-SEAL
--                   (verdict MSG-20260810-232157-06rt · 스코프={crm,foot})
--   canonical SSOT: agents/docs/cross_crm_auth_identity_standard.md §8-B (v0.9)
--
-- ── change-class ──────────────────────────────────────────────────────────────
--   RESTRICTIVE grant-surface tighten (grant 회수·기능 축소·신규 스키마 0·blast0).
--   CEO 파괴게이트 §3.1 면제. GRANT/REVOKE = catalog-mutating → supervisor DB-GATE
--   (DDL-diff/grant-diff + GO-token) 물리 선행 필수(apply_before_go 금지).
--
-- ── ★prod 재확인 (AC-1, read-only introspection 2026-08-11, Mgmt API) ───────────
--   FUNCTION proacl (실측):
--     record_auth_action(uuid,text,text,jsonb)     = {postgres=X, authenticated=X, service_role=X}
--     stamp_auth_action_outcome(bigint,text)       = {postgres=X, authenticated=X, service_role=X}
--     → ★foot 는 crm 자매와 달리 함수 proacl 에 anon=X 가 **이미 부재**(PUBLIC 도 부재).
--       overload 없음(각 fn 정확히 1개, 서명 canonical 일치). 함수-레벨 REVOKE=no-op.
--   TABLE staff_auth_action_audit relacl (실측):
--     {postgres=arwdDxtm, anon=rxtm, authenticated=rxtm, service_role=arwdDxtm}  (RLS forced=t)
--     → ★anon=rxtm (SELECT/REFERENCES/TRIGGER/MAINTAIN) 잔존 = 본 seal 의 유일 실질 델타.
--       RLS FORCED + anon0정책 으로 현재 inert(belt-and-suspenders 위생 회수).
--   ⇒ foot 순델타 = 테이블 anon grant 회수 1건. 함수 블록은 byte-identical 포스처 목적
--     (idempotent no-op·re-drift 방지 seal)로 canonical 그대로 포함(AC-1/AC-3 요구).
--
-- ── AC-2 (H1) service_role census — blanket-strip 금지 ──────────────────────────
--   per-fork census: 두 fn 을 service_role 로 호출하는 EF 경로 실재 여부.
--     grep 전수 → supabase/functions/admin-register-staff/index.ts 만 두 fn 호출.
--     호출 클라이언트 = `callerClient`(anonKey + 호출자 JWT Authorization 헤더, index.ts:219-222)
--       = authenticated 스코프(auth.uid 서버확정 보존). service_role `admin` 클라이언트는
--       GoTrue admin(create/get/delete)에만 사용 — 두 fn RPC 호출에 미사용.
--   ⇒ service_role 호출경로 **부재** → canonical byte-identical 대로 service_role GRANT
--     **미부여**(IFF 미충족). 기존 proacl 의 service_role=X(Supabase default-priv)는
--     byte-identical 블록이 손대지 않음(REVOKE 대상=PUBLIC/anon 만) → 존치.
--   authenticated GRANT 는 재-assert(blanket-strip 금지·정상 admin caller 무손상).
--
-- ── AC-6 (H5) grant-surface only ─────────────────────────────────────────────────
--   append-only/immutable 계약(no DELETE / outcome 1회 UPDATE / actor·target·action
--   ·occurred_at immutable) **무변경**. 정책/트리거/컬럼/RLS 무접촉.
--
--   down     : 20260811030000_foot_secdef_anon_exec_revoke_seal.rollback.sql
--   dryrun   : 20260811030000_foot_secdef_anon_exec_revoke_seal.dryrun.mjs (No-Persistence)
--   postcheck: AC-4(proacl 재실측) + AC-5(A7 anon-EXEC sensor 이탈) = apply 後 (supervisor GO-token lane)
-- 작성: dev-foot / 2026-08-11
-- ============================================================================

-- ── (0) PREFLIGHT: 대상 실재 + 서명/overload 정확 매칭 (wrong-DB / 서명 drift 방지) ──
DO $preflight$
DECLARE
  n_record int;
  n_stamp  int;
  n_table  int;
BEGIN
  SELECT count(*) INTO n_record
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname = 'record_auth_action'
      AND pg_get_function_identity_arguments(p.oid)
          = 'p_target_user_id uuid, p_target_email text, p_action text, p_request_meta jsonb';
  SELECT count(*) INTO n_stamp
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname = 'stamp_auth_action_outcome'
      AND pg_get_function_identity_arguments(p.oid) = 'p_audit_id bigint, p_outcome text';
  SELECT count(*) INTO n_table
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'staff_auth_action_audit';

  IF n_record <> 1 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: record_auth_action(uuid,text,text,jsonb) 정확매칭 % 건(기대 1) — 서명 drift/wrong DB?', n_record;
  END IF;
  IF n_stamp <> 1 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: stamp_auth_action_outcome(bigint,text) 정확매칭 % 건(기대 1) — 서명 drift/wrong DB?', n_stamp;
  END IF;
  IF n_table <> 1 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: staff_auth_action_audit 부재 — wrong DB?';
  END IF;
END
$preflight$;

-- ── (1) canonical §8-B grant-seal 블록 (byte-identical · AC-1/AC-3) ─────────────
REVOKE EXECUTE ON FUNCTION
  public.record_auth_action(uuid, text, text, jsonb),
  public.stamp_auth_action_outcome(bigint, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.record_auth_action(uuid, text, text, jsonb),
  public.stamp_auth_action_outcome(bigint, text)
TO authenticated;   -- intended-caller-tier(auth.uid() 서버확정) · (+ service_role IFF EF service_role 호출경로 실재·dev census)
REVOKE ALL ON TABLE public.staff_auth_action_audit FROM anon;  -- 테이블 default-priv 위생(RLS FORCED+anon0정책으로 이미 inert=belt-and-suspenders)

-- ── (2) POST-ASSERT (동일 txn 내 자가검증 — AC-4 의 apply-time 사전확인) ──────────
DO $postassert$
DECLARE
  rec_acl text;
  stp_acl text;
  tbl_acl text;
BEGIN
  SELECT proacl::text INTO rec_acl FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
    WHERE ns.nspname='public' AND p.proname='record_auth_action';
  SELECT proacl::text INTO stp_acl FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
    WHERE ns.nspname='public' AND p.proname='stamp_auth_action_outcome';
  SELECT relacl::text INTO tbl_acl FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE ns.nspname='public' AND c.relname='staff_auth_action_audit';

  -- 함수: anon 부재 + authenticated present (AC-4)
  IF rec_acl LIKE '%anon=%'  THEN RAISE EXCEPTION 'POSTASSERT_FAIL: record_auth_action proacl 에 anon 잔존: %', rec_acl; END IF;
  IF stp_acl LIKE '%anon=%'  THEN RAISE EXCEPTION 'POSTASSERT_FAIL: stamp_auth_action_outcome proacl 에 anon 잔존: %', stp_acl; END IF;
  IF rec_acl NOT LIKE '%authenticated=%' THEN RAISE EXCEPTION 'POSTASSERT_FAIL: record_auth_action authenticated GRANT 부재(blanket-strip?): %', rec_acl; END IF;
  IF stp_acl NOT LIKE '%authenticated=%' THEN RAISE EXCEPTION 'POSTASSERT_FAIL: stamp_auth_action_outcome authenticated GRANT 부재(blanket-strip?): %', stp_acl; END IF;
  -- 테이블: anon grant 회수
  IF tbl_acl LIKE '%anon=%'  THEN RAISE EXCEPTION 'POSTASSERT_FAIL: staff_auth_action_audit relacl 에 anon grant 잔존: %', tbl_acl; END IF;
END
$postassert$;
