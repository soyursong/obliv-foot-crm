-- T-20260724-foot-NHIS-MANUAL-CAPTURE — 건보 자격 수기조회 조회 감사 RPC (하드가드 #5)
--
-- DA CONSULT-REPLY: da_decision_foot_nhis_manual_capture_lookup_audit_rpc_20260724.md (gate=GO_ADDITIVE)
--   MSG-20260724-111621-i053 · binding 4조건 준수(frontmatter da_consult.binding_conditions):
--     ① 신규 감사 테이블 금지 → 기존 phi_access_log 재사용 (access_type='nhis_eligibility_lookup', TEXT·CHECK없음)
--     ② anti-IDOR: accessed_by/role/clinic 전량 서버측 파생(인자 = p_customer_id 1개만)
--     ③ PII 최소화: RRN·증번호·수진자성명·자격결과·등급값 미저장 = customer_id FK + 메타만
--     ④ §16-4c: CREATE 직후 REVOKE EXECUTE FROM PUBLIC,anon + GRANT authenticated + search_path 고정
--
-- 순수 ADDITIVE (신규 SECDEF 함수 1개 + 기존 phi_access_log INSERT + 신규 access_type 값). 파괴 0.
-- ★supervisor 종료게이트(§16-5): 적용 전 phi_access_log 실재 introspection 필수. 부재 시 §16-4b 표준
--   스키마대로 CREATE 를 동일 마이그에 ADDITIVE 포함. current_user_role()/current_user_clinic_id() 헬퍼
--   실재도 재확인(부재 시 동등 헬퍼 치환, 발산 금지). — dev-foot 은 canonical 헬퍼 실보유 가정으로 작성.
--
-- 함수 시그니처 = DA SSOT §권고 함수 시그니처 (심볼이 정본).

CREATE OR REPLACE FUNCTION public.log_nhis_eligibility_lookup(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clinic_id uuid := current_user_clinic_id();
BEGIN
  -- anti-IDOR defense-in-depth: 대상 환자가 caller clinic 소속인지 확인.
  -- 불일치 시 RAISE 금지(§16-4b INV1 무중단 + 하드가드 #6 소프트게이트) → skip.
  IF NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = p_customer_id AND c.clinic_id = v_clinic_id
  ) THEN
    RAISE NOTICE 'nhis lookup audit skipped: customer % out of caller clinic scope', p_customer_id;
    RETURN;
  END IF;

  -- 감사 적재: PHI 원문 미저장(메타만). 로깅 실패가 동선 break 금지(§16-4b INV1 예외격리).
  BEGIN
    INSERT INTO public.phi_access_log
      (accessed_by,  accessed_role,        access_type,               customer_id,   clinic_id)
    VALUES
      (auth.uid(),   current_user_role(),  'nhis_eligibility_lookup', p_customer_id, v_clinic_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'phi_access_log insert skipped: %', SQLERRM;
  END;
END;
$$;

-- §16-4c: 기본 PUBLIC EXECUTE 회수 + authenticated(=로그인 스태프)만
--   (환자/키오스크=anon → 본 RPC anon 동선 아님. §16-4c derm 20260618 PUBLIC 잔존 사고 재발 방지)
REVOKE EXECUTE ON FUNCTION public.log_nhis_eligibility_lookup(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.log_nhis_eligibility_lookup(uuid) TO authenticated;

COMMENT ON FUNCTION public.log_nhis_eligibility_lookup(uuid) IS
  'T-20260724-foot-NHIS-MANUAL-CAPTURE: 건보 수기조회 개시 감사(READ tier). phi_access_log INSERT(메타만, PHI 미저장). 인자=customer_id 1개, by/role/clinic 서버측 파생(anti-IDOR).';
