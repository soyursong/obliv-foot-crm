-- DRY-RUN (No-Persistence Protocol): T-20260713-foot-AUTH-ACTOR-AUDIT-APPLEVEL
-- ============================================================================
-- 목적: §8-B 감사테이블 + RLS + record/stamp 함수 2를 prod(rxlomoozakkjesdqjtvd)에 무영속 적용→AC 검증→롤백.
-- 프로토콜(sentinel-bypass 차단):
--   ① txn-control strip: 실행 body 에 BEGIN/COMMIT 없음.
--   ② plpgsql exception-handler: 단일 DO 트랜잭션 + 末尾 SENTINEL RAISE 강제 abort → 全 DDL 롤백(무영속).
--   ③ post-probe: §POST 로 prod 에 테이블/함수 부재 재확인(비영속 실증).
-- 판정: 'DRYRUN_SENTINEL_OK'(P0001)=全 AC PASS+무영속 롤백 / 'AC-x FAIL'=검증실패 / 그 외=DDL오류.
-- 실행: scripts/T-20260713-foot-AUTH-ACTOR-AUDIT-APPLEVEL_dryrun.mjs
-- ============================================================================

DO $dry$
DECLARE
  v_cnt INT; v_bool BOOLEAN; v_txt TEXT; v_id BIGINT; v_outcome TEXT;
BEGIN
  -- (1) §8-B 테이블 무영속 생성 (byte-identical shape)
  EXECUTE $ddl$
    CREATE TABLE public.staff_auth_action_audit (
      id             bigint      generated always as identity primary key,
      actor_staff_id uuid        null,
      target_user_id uuid        not null,
      target_email   text        null,
      action         text        not null,
      outcome        text        not null default 'attempted',
      request_meta   jsonb       null,
      occurred_at    timestamptz not null default now()
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

  -- (2) record/stamp 함수 무영속 생성
  EXECUTE $fn1$
    CREATE OR REPLACE FUNCTION public.record_auth_action(p_target_user_id UUID, p_target_email TEXT, p_action TEXT, p_request_meta JSONB DEFAULT NULL)
    RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, auth AS $b$
    DECLARE v_actor UUID := auth.uid(); v_staff_id UUID; v_id BIGINT;
    BEGIN
      IF v_actor IS NULL THEN RAISE EXCEPTION 'no actor' USING ERRCODE='28000'; END IF;
      SELECT s.id INTO v_staff_id FROM public.staff s WHERE s.user_id=v_actor LIMIT 1;
      INSERT INTO public.staff_auth_action_audit(actor_staff_id, target_user_id, target_email, action, outcome, request_meta)
      VALUES (v_staff_id, p_target_user_id, NULLIF(lower(trim(p_target_email)),''), p_action, 'attempted', p_request_meta)
      RETURNING id INTO v_id; RETURN v_id;
    END; $b$
  $fn1$;
  EXECUTE $fn2$
    CREATE OR REPLACE FUNCTION public.stamp_auth_action_outcome(p_audit_id BIGINT, p_outcome TEXT)
    RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $b$
    BEGIN
      IF p_audit_id IS NULL THEN RETURN; END IF;
      IF p_outcome NOT IN ('succeeded','failed') THEN RAISE EXCEPTION 'invalid outcome %', p_outcome USING ERRCODE='22023'; END IF;
      UPDATE public.staff_auth_action_audit SET outcome=p_outcome WHERE id=p_audit_id AND outcome='attempted';
    END; $b$
  $fn2$;

  -- ══════════════ AC 검증 ══════════════

  -- AC-1: §8-B 컬럼 byte-identical (7 non-id 컬럼 정확)
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='staff_auth_action_audit'
     AND column_name IN ('actor_staff_id','target_user_id','target_email','action','outcome','request_meta','occurred_at');
  IF v_cnt <> 7 THEN RAISE EXCEPTION 'AC-1 FAIL: expected 7 §8-B columns, got %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='staff_auth_action_audit';
  IF v_cnt <> 8 THEN RAISE EXCEPTION 'AC-1 FAIL: extra/missing columns (want id+7, got %)', v_cnt; END IF;
  -- target_user_id NOT NULL / outcome default attempted 확인
  SELECT is_nullable INTO v_txt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='staff_auth_action_audit' AND column_name='target_user_id';
  IF v_txt <> 'NO' THEN RAISE EXCEPTION 'AC-1 FAIL: target_user_id must be NOT NULL'; END IF;

  -- AC-3a: RLS enabled+forced
  SELECT relrowsecurity AND relforcerowsecurity INTO v_bool FROM pg_class WHERE oid='public.staff_auth_action_audit'::regclass;
  IF NOT v_bool THEN RAISE EXCEPTION 'AC-3 FAIL: RLS not enabled/forced'; END IF;

  -- AC-3b: SELECT 정책 1개(admin) + write 정책 0 (append-only via 함수 전용)
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname='public' AND tablename='staff_auth_action_audit' AND cmd='SELECT';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'AC-3 FAIL: expected 1 SELECT policy, got %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname='public' AND tablename='staff_auth_action_audit' AND cmd IN ('INSERT','UPDATE','DELETE','ALL');
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'AC-3 FAIL: append-only violated — % write policies', v_cnt; END IF;

  -- AC-3c: authenticated 직접 write 권한 회수
  IF has_table_privilege('authenticated','public.staff_auth_action_audit','INSERT')
     OR has_table_privilege('authenticated','public.staff_auth_action_audit','UPDATE')
     OR has_table_privilege('authenticated','public.staff_auth_action_audit','DELETE') THEN
    RAISE EXCEPTION 'AC-3 FAIL: authenticated retains direct write privilege';
  END IF;
  IF NOT has_table_privilege('authenticated','public.staff_auth_action_audit','SELECT') THEN
    RAISE EXCEPTION 'AC-3 FAIL: authenticated lost SELECT (RLS admin gate needs base grant)';
  END IF;

  -- AC-2/AC-4: two-phase attempted→succeeded 흐름 (함수 경유). auth.uid() 없음 → 직접 INSERT 로 시뮬.
  INSERT INTO public.staff_auth_action_audit(actor_staff_id, target_user_id, target_email, action)
  VALUES (NULL, gen_random_uuid(), 'someone@clinic.test', 'password_reset') RETURNING id INTO v_id;
  SELECT outcome INTO v_outcome FROM public.staff_auth_action_audit WHERE id=v_id;
  IF v_outcome <> 'attempted' THEN RAISE EXCEPTION 'AC-4 FAIL: default outcome must be attempted, got %', v_outcome; END IF;
  -- stamp 1회 전이
  PERFORM public.stamp_auth_action_outcome(v_id, 'succeeded');
  SELECT outcome INTO v_outcome FROM public.staff_auth_action_audit WHERE id=v_id;
  IF v_outcome <> 'succeeded' THEN RAISE EXCEPTION 'AC-4 FAIL: stamp did not transition to succeeded, got %', v_outcome; END IF;
  -- stamp 재호출은 no-op (1회만) — 이미 succeeded → attempted 아님
  PERFORM public.stamp_auth_action_outcome(v_id, 'failed');
  SELECT outcome INTO v_outcome FROM public.staff_auth_action_audit WHERE id=v_id;
  IF v_outcome <> 'succeeded' THEN RAISE EXCEPTION 'AC-4 FAIL: outcome mutated after final (want succeeded, got %)', v_outcome; END IF;
  -- invalid outcome 거부
  v_bool := false;
  BEGIN PERFORM public.stamp_auth_action_outcome(v_id, 'bogus');
  EXCEPTION WHEN others THEN v_bool := true; END;
  IF NOT v_bool THEN RAISE EXCEPTION 'AC-4 FAIL: invalid outcome NOT rejected'; END IF;

  -- AC-2: record/stamp 함수 존재 + auth.uid 서버확정
  SELECT pg_get_functiondef('public.record_auth_action(uuid,text,text,jsonb)'::regprocedure) INTO v_txt;
  IF position('auth.uid()' IN v_txt)=0 THEN RAISE EXCEPTION 'AC-2 FAIL: record_auth_action must resolve actor via auth.uid()'; END IF;

  RAISE EXCEPTION 'DRYRUN_SENTINEL_OK' USING ERRCODE = 'P0001';
END
$dry$;
