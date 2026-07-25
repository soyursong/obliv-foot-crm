-- DRY-RUN (No-Persistence): T-20260725-foot-INSURANCE-GRADE-SECDEF-RPC
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · up.sql 에 top-level txn-control(COMMIT 등) 없음 = sentinel-bypass hazard 부재 → BEGIN..ROLLBACK 무영속.
--   · txn 내부 assertion(DO $chk$): 함수 존재·시그니처·SECDEF·anon EXECUTE 부재 실검증, 실패 시 RAISE → abort.
--   · 사후 무영속(post-probe)은 canonical 러너가 별 트랜잭션에서 pg_proc 부재 재확인.
BEGIN;

-- ── payload (up.sql 본문 미러 — 함수 CREATE) ───────────────────────────────────
CREATE OR REPLACE FUNCTION update_insurance_grade(
  p_customer_id UUID,
  p_grade       TEXT,
  p_source      TEXT,
  p_memo        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_clinic UUID;
  v_cust_clinic   UUID;
  v_found         BOOLEAN;
  v_rows          INTEGER;
BEGIN
  IF NOT is_approved_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', '승인되지 않은 사용자입니다. 관리자에게 문의하세요.');
  END IF;
  IF NOT (is_floor_staff() OR is_consultant_or_above() OR is_coordinator_or_above()) THEN
    RETURN jsonb_build_object('ok', false, 'error', '보험 자격등급을 변경할 권한이 없습니다.');
  END IF;
  IF p_grade IS NULL OR p_grade NOT IN (
    'general','low_income_1','low_income_2','medical_aid_1','medical_aid_2',
    'infant','elderly_flat','foreigner','unverified'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', format('허용되지 않은 자격등급입니다(%s).', COALESCE(p_grade, 'NULL')));
  END IF;
  IF p_source IS NULL OR p_source NOT IN (
    'jeoneung_crm','eligibility_cert','hira_lookup','manual_input'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', format('허용되지 않은 등급 출처입니다(%s).', COALESCE(p_source, 'NULL')));
  END IF;
  SELECT (id IS NOT NULL), clinic_id INTO v_found, v_cust_clinic FROM customers WHERE id = p_customer_id;
  IF NOT COALESCE(v_found, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', '저장 대상 고객을 찾지 못했습니다.');
  END IF;
  v_caller_clinic := current_user_clinic_id();
  IF v_caller_clinic IS NOT NULL AND v_cust_clinic IS NOT NULL AND v_cust_clinic <> v_caller_clinic THEN
    RETURN jsonb_build_object('ok', false, 'error', '다른 지점 고객의 자격등급은 변경할 수 없습니다.');
  END IF;
  UPDATE customers
  SET insurance_grade = p_grade, insurance_grade_source = p_source,
      insurance_grade_verified_at = now(), insurance_grade_memo = p_memo
  WHERE id = p_customer_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '저장 대상을 찾지 못했습니다. 다시 시도해 주세요.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'customer_id', p_customer_id, 'grade', p_grade);
END;
$$;

REVOKE ALL ON FUNCTION update_insurance_grade(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_insurance_grade(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ── txn 내부 검증: 함수 존재 + SECDEF + anon EXECUTE 부재 (실패 시 abort) ──
DO $chk$
DECLARE
  v_proc  INTEGER;
  v_secdef BOOLEAN;
  v_anon  INTEGER;
BEGIN
  SELECT COUNT(*), bool_or(prosecdef) INTO v_proc, v_secdef
  FROM pg_proc WHERE proname = 'update_insurance_grade'
    AND pronamespace = 'public'::regnamespace;
  IF v_proc <> 1 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: update_insurance_grade 함수 미생성 (got: %)', v_proc;
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: SECURITY DEFINER 미설정';
  END IF;

  -- anon/PUBLIC EXECUTE 부재 확인 (SECDEF-ANON-EXECUTE-HYGIENE)
  SELECT COUNT(*) INTO v_anon
  FROM information_schema.role_routine_grants
  WHERE routine_name = 'update_insurance_grade'
    AND grantee IN ('anon', 'PUBLIC')
    AND privilege_type = 'EXECUTE';
  IF v_anon <> 0 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: anon/PUBLIC EXECUTE grant 잔존 (got: %)', v_anon;
  END IF;

  RAISE NOTICE 'DRYRUN-OK: update_insurance_grade SECDEF 함수 1개 생성 + anon EXECUTE 부재 확인';
END $chk$;

ROLLBACK;
