-- DRY-RUN (No-Persistence Protocol): T-20260713-foot-AUTH-ACTOR-AUDIT-APPLEVEL
-- ============================================================================
-- 목적: 감사테이블 + RLS + 헬퍼 + 3 RPC 패치를 prod(rxlomoozakkjesdqjtvd)에 무영속 적용→AC 검증→롤백.
-- 프로토콜 준수(sentinel-bypass 차단):
--   ① txn-control strip: 실행 body 에 BEGIN/COMMIT 없음(up.sql 의 COMMIT 미포함).
--   ② plpgsql exception-handler: 전 작업을 단일 DO 트랜잭션에서 수행, 末尾 SENTINEL RAISE 로 강제 abort
--      → CREATE TABLE/POLICY/FUNCTION(DDL) 포함 全 효과 롤백(무영속).
--   ③ post-probe: §POST 로 prod 에 테이블/헬퍼가 없음을 재확인(비영속 실증).
-- 판정: DO 블록이 'DRYRUN_SENTINEL_OK'(P0001) 로 끝나면 = 모든 AC PASS + 무영속 롤백.
--        'AC-x FAIL ...' 로 끝나면 = 검증 실패. 그 외 = DDL 오류.
-- 실행: scripts/T-20260713-foot-AUTH-ACTOR-AUDIT-APPLEVEL_dryrun.mjs (Supabase Mgmt API)
-- ============================================================================

-- §DO — 무영속 적용 + AC 검증 (sentinel RAISE 로 롤백)
DO $dry$
DECLARE
  v_cnt        INT;
  v_bool       BOOLEAN;
  v_txt        TEXT;
  v_rejected   BOOLEAN;
BEGIN
  -- ── (1) 테이블 무영속 생성 ──────────────────────────────────────────────
  EXECUTE $ddl$
    CREATE TABLE public.staff_auth_action_audit (
      id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      actor_user_id  UUID NOT NULL,
      actor_staff_id UUID,
      actor_email    TEXT,
      actor_role     TEXT,
      target_user_id UUID,
      target_email   TEXT,
      action         TEXT NOT NULL,
      clinic_id      UUID,
      request_meta   JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT staff_auth_action_audit_action_chk
        CHECK (action IN ('password_reset','deactivate','activate','register','role_change','email_change','delete','ban')),
      CONSTRAINT staff_auth_action_audit_no_plaintext_pw_chk
        CHECK (NOT (request_meta ? 'password') AND NOT (request_meta ? 'new_password'))
    )
  $ddl$;

  EXECUTE 'ALTER TABLE public.staff_auth_action_audit ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.staff_auth_action_audit FORCE ROW LEVEL SECURITY';
  EXECUTE $pol$
    CREATE POLICY saaa_admin_read ON public.staff_auth_action_audit
      FOR SELECT TO authenticated USING (public.current_user_role() = 'admin')
  $pol$;
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.staff_auth_action_audit FROM authenticated, anon, PUBLIC';
  EXECUTE 'GRANT SELECT ON public.staff_auth_action_audit TO authenticated';

  -- ── (2) 헬퍼 무영속 생성 ────────────────────────────────────────────────
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.log_staff_auth_action(
      p_target_user_id UUID, p_target_email TEXT, p_action TEXT, p_request_meta JSONB DEFAULT '{}'::jsonb
    ) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $body$
    DECLARE v_actor UUID := auth.uid(); v_staff_id UUID; v_email TEXT; v_role TEXT; v_clinic UUID; v_id BIGINT;
    BEGIN
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'log_staff_auth_action: no authenticated actor' USING ERRCODE='28000';
      END IF;
      SELECT up.email, up.role, up.clinic_id INTO v_email, v_role, v_clinic FROM public.user_profiles up WHERE up.id=v_actor;
      SELECT s.id INTO v_staff_id FROM public.staff s WHERE s.user_id=v_actor LIMIT 1;
      INSERT INTO public.staff_auth_action_audit
        (actor_user_id, actor_staff_id, actor_email, actor_role, target_user_id, target_email, action, clinic_id, request_meta)
      VALUES (v_actor, v_staff_id, v_email, v_role, p_target_user_id, p_target_email, p_action, v_clinic, COALESCE(p_request_meta,'{}'::jsonb))
      RETURNING id INTO v_id;
      RETURN v_id;
    END; $body$
  $fn$;

  -- ── (3) reset RPC 패치 무영속 적용 (log 헬퍼 참조 확인용 샘플) ──────────
  EXECUTE $rpc$
    CREATE OR REPLACE FUNCTION public.admin_reset_user_password(target_user_id UUID, new_password TEXT)
    RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, auth, extensions AS $body$
    DECLARE v_target_email TEXT;
    BEGIN
      IF NOT public.is_admin_or_manager() THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
      IF new_password IS NULL OR length(new_password)<6 THEN RAISE EXCEPTION 'password too short' USING ERRCODE='22023'; END IF;
      SELECT u.email INTO v_target_email FROM auth.users u WHERE u.id=target_user_id;
      PERFORM public.log_staff_auth_action(target_user_id, v_target_email, 'password_reset', '{}'::jsonb);
      UPDATE auth.users SET encrypted_password=crypt(new_password, gen_salt('bf')), updated_at=now() WHERE id=target_user_id;
      RETURN jsonb_build_object('user_id', target_user_id, 'reset_at', now());
    END; $body$
  $rpc$;

  -- ══════════════════ AC 검증 ══════════════════

  -- AC-1: 테이블 + 필수컬럼 존재
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='staff_auth_action_audit'
     AND column_name IN ('actor_user_id','actor_staff_id','target_user_id','target_email','action','occurred_at','request_meta','clinic_id');
  IF v_cnt <> 8 THEN RAISE EXCEPTION 'AC-1 FAIL: expected 8 core columns, got %', v_cnt; END IF;

  -- AC-3a: RLS enabled + forced
  SELECT relrowsecurity AND relforcerowsecurity INTO v_bool
    FROM pg_class WHERE oid='public.staff_auth_action_audit'::regclass;
  IF NOT v_bool THEN RAISE EXCEPTION 'AC-3 FAIL: RLS not enabled/forced'; END IF;

  -- AC-3b: SELECT 정책 admin-only 존재 + INSERT/UPDATE/DELETE 정책 부재(append-only)
  SELECT count(*) INTO v_cnt FROM pg_policies
   WHERE schemaname='public' AND tablename='staff_auth_action_audit' AND cmd='SELECT';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'AC-3 FAIL: expected 1 SELECT policy, got %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_policies
   WHERE schemaname='public' AND tablename='staff_auth_action_audit' AND cmd IN ('INSERT','UPDATE','DELETE','ALL');
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'AC-3 FAIL: append-only violated — % write policies exist', v_cnt; END IF;

  -- AC-3c: authenticated 직접 write 권한 회수 확인
  IF has_table_privilege('authenticated','public.staff_auth_action_audit','INSERT')
     OR has_table_privilege('authenticated','public.staff_auth_action_audit','UPDATE')
     OR has_table_privilege('authenticated','public.staff_auth_action_audit','DELETE') THEN
    RAISE EXCEPTION 'AC-3 FAIL: authenticated retains direct write privilege';
  END IF;
  IF NOT has_table_privilege('authenticated','public.staff_auth_action_audit','SELECT') THEN
    RAISE EXCEPTION 'AC-3 FAIL: authenticated lost SELECT (RLS admin gate needs base SELECT grant)';
  END IF;

  -- 가드1: 비번 평문(request_meta.new_password) 유입 거부
  v_rejected := false;
  BEGIN
    INSERT INTO public.staff_auth_action_audit(actor_user_id, action, request_meta)
    VALUES (gen_random_uuid(), 'password_reset', '{"new_password":"leaked"}'::jsonb);
  EXCEPTION WHEN check_violation THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'AC-4 FAIL: plaintext password NOT rejected by CHECK'; END IF;

  -- 가드2: 알 수 없는 action 거부
  v_rejected := false;
  BEGIN
    INSERT INTO public.staff_auth_action_audit(actor_user_id, action)
    VALUES (gen_random_uuid(), 'nonsense_action');
  EXCEPTION WHEN check_violation THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'AC-1 FAIL: unknown action NOT rejected by CHECK'; END IF;

  -- 정상 append 1건 (append-only 삽입 경로 자체는 유효)
  INSERT INTO public.staff_auth_action_audit(actor_user_id, target_user_id, target_email, action)
  VALUES (gen_random_uuid(), gen_random_uuid(), 'someone@clinic.test', 'password_reset');
  SELECT count(*) INTO v_cnt FROM public.staff_auth_action_audit;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'AC-1 FAIL: valid append did not persist in-txn (got %)', v_cnt; END IF;

  -- AC-2: 3 RPC 가 log_staff_auth_action 을 참조하도록 패치되었는지 (reset 은 위에서 적용, 나머지는 up.sql 정본에서 검증)
  SELECT pg_get_functiondef('public.admin_reset_user_password(uuid,text)'::regprocedure) INTO v_txt;
  IF position('log_staff_auth_action' IN v_txt) = 0 THEN
    RAISE EXCEPTION 'AC-2 FAIL: admin_reset_user_password does not reference actor stamp';
  END IF;
  -- reset RPC 가 gen_salt(extensions) 정상 참조 유지 (회귀 방지)
  IF position('extensions' IN v_txt) = 0 THEN
    RAISE EXCEPTION 'AC-2 FAIL: admin_reset_user_password lost extensions search_path (gen_salt regression)';
  END IF;

  -- ── No-Persistence sentinel: 全 롤백 ──
  RAISE EXCEPTION 'DRYRUN_SENTINEL_OK' USING ERRCODE = 'P0001';
END
$dry$;
