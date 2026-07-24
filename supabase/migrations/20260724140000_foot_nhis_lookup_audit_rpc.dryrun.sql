-- DRY-RUN (No-Persistence Protocol) — T-20260724-foot-NHIS-MANUAL-CAPTURE 조회 감사 RPC
--
-- ── 무영속 보장(sentinel-bypass 불가) ────────────────────────────────────────
--   전체를 단일 DO 블록(= 단일 statement, 단일 서브트랜잭션)으로 실행. 블록 내에서 함수를 EXECUTE 로
--   생성하고 검증한 뒤, 블록 말미 RAISE EXCEPTION 으로 강제 unwind → 생성 함수는 어떤 것도 영속되지 않음.
--   단일 statement 이므로 Management API /database/query 의 autocommit-between-statements 불가.
--   up.sql 에 BEGIN/COMMIT/트랜잭션 제어문 없음(순수 CREATE FUNCTION + REVOKE/GRANT) → txn-strip 무해.
--
-- ── 검증(기대) ────────────────────────────────────────────────────────────────
--   1) 함수 정의 문법 유효 (CREATE 성공)                                → PASS
--   2) 시그니처 = log_nhis_eligibility_lookup(uuid) RETURNS void         → PASS
--   3) prosecdef = true (SECURITY DEFINER)                              → PASS
--   4) proconfig 에 search_path=public, pg_temp 고정                     → PASS
--   ⚠ behavioral(authenticated 1행 적재 / anon 거부 / 타clinic skip / 로깅실패 무중단)은
--      JWT 세션 필요 → supervisor 종료게이트(authenticated 세션)에서 검증. dryrun 스코프 아님.
--
-- ── POST-PROBE (무영속 재확인, 별도 read-only 세션) ───────────────────────────
--   SELECT count(*) FROM pg_proc WHERE proname='log_nhis_eligibility_lookup';   -- 기대 0(미영속)
--
--   ⚠ 결과는 블록 말미 RAISE EXCEPTION 메시지('DRYRUN RESULT: ...')로 반환. 'ALL PASS' = 4종 통과.

DO $dryrun$
DECLARE
  v_result   text := '';
  v_all_pass boolean := true;
  v_secdef   boolean;
  v_config   text[];
  v_rettype  text;
  v_exists   boolean;
BEGIN
  -- (1) 함수 생성 (문법 검증)
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.log_nhis_eligibility_lookup(p_customer_id uuid)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $body$
    DECLARE
      v_clinic_id uuid := current_user_clinic_id();
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.customers c
        WHERE c.id = p_customer_id AND c.clinic_id = v_clinic_id
      ) THEN
        RAISE NOTICE 'nhis lookup audit skipped: customer % out of caller clinic scope', p_customer_id;
        RETURN;
      END IF;
      BEGIN
        INSERT INTO public.phi_access_log
          (accessed_by, accessed_role, access_type, customer_id, clinic_id)
        VALUES
          (auth.uid(), current_user_role(), 'nhis_eligibility_lookup', p_customer_id, v_clinic_id);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'phi_access_log insert skipped: %', SQLERRM;
      END;
    END;
    $body$;
  $fn$;
  v_result := v_result || '(1) CREATE FUNCTION: PASS' || E'\n';

  -- (2) 시그니처/반환형
  SELECT p.prosecdef, p.proconfig, pg_catalog.format_type(p.prorettype, NULL)
    INTO v_secdef, v_config, v_rettype
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='log_nhis_eligibility_lookup'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_customer_id uuid';
  v_exists := FOUND;
  IF v_exists AND v_rettype = 'void' THEN
    v_result := v_result || '(2) signature (uuid)->void: PASS' || E'\n';
  ELSE
    v_result := v_result || '(2) signature: FAIL (found=' || v_exists || ', rettype=' || COALESCE(v_rettype,'?') || ')' || E'\n';
    v_all_pass := false;
  END IF;

  -- (3) SECURITY DEFINER
  IF v_secdef THEN
    v_result := v_result || '(3) SECURITY DEFINER: PASS' || E'\n';
  ELSE
    v_result := v_result || '(3) SECURITY DEFINER: FAIL' || E'\n';
    v_all_pass := false;
  END IF;

  -- (4) search_path 고정
  IF v_config IS NOT NULL AND array_to_string(v_config, ',') ILIKE '%search_path=public, pg_temp%' THEN
    v_result := v_result || '(4) search_path fixed: PASS' || E'\n';
  ELSE
    v_result := v_result || '(4) search_path fixed: FAIL (' || COALESCE(array_to_string(v_config, ','),'null') || ')' || E'\n';
    v_all_pass := false;
  END IF;

  -- 강제 unwind (무영속) — 생성 함수 롤백
  RAISE EXCEPTION 'DRYRUN RESULT: %  %',
    CASE WHEN v_all_pass THEN 'ALL PASS' ELSE 'HAS FAIL' END, E'\n' || v_result;
END;
$dryrun$;
