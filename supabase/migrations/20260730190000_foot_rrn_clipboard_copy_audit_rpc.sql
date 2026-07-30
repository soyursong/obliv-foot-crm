-- T-20260730-foot-RRN-CLIPBOARD-COPY-NHIS — 주민번호 클립보드 반출 감사 RPC
--
-- DA CONSULT-REPLY: DA-20260730-foot-RRN-CLIPBOARD-COPY-AUDIT-RPC (gate=GO_ADDITIVE)
--   MSG-20260730-192214-0i1t · 발산0 확증(형제 log_nhis_eligibility_lookup 대비 access_type 리터럴만 상이).
--   binding 4조건 준수(형제와 동일):
--     ① 신규 감사 테이블 금지 → 기존 phi_access_log 재사용 (access_type='rrn_clipboard_copy', TEXT·CHECK없음)
--     ② anti-IDOR: accessed_by/role/clinic 전량 서버측 파생(인자 = p_customer_id 1개만). 역할 게이트 추가 금지.
--     ③ PII 최소화: RRN 미저장 = customer_id FK + 메타만
--     ④ §16-4c: CREATE 직후 REVOKE EXECUTE FROM PUBLIC,anon + GRANT authenticated + search_path 고정
--
-- 순수 ADDITIVE (신규 SECDEF 함수 1개 + 기존 phi_access_log INSERT + 신규 access_type 값). 파괴 0.
-- ★supervisor 종료게이트(§16-5): 적용 전 phi_access_log 실재 introspection 필수(evidence 파일 첨부).
--   current_user_role()/current_user_clinic_id() 헬퍼 실재도 재확인(부재 시 동등 헬퍼 치환, 발산 금지).
--
-- "차트 열람"(rrn_decrypt → phi_access_log 1행)과 "주민번호 클립보드 반출"은 위험도가 다르므로 별도 기록.
--   복사 버튼은 메모리의 rrnFull 을 쓰므로 복호 호출이 없음 → 이 RPC 없이는 감사가 남지 않는다.

CREATE OR REPLACE FUNCTION public.log_rrn_clipboard_copy(p_customer_id uuid)
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
    RAISE NOTICE 'rrn clipboard audit skipped: customer % out of caller clinic scope', p_customer_id;
    RETURN;
  END IF;

  -- 감사 적재: PHI 원문 미저장(메타만). 로깅 실패가 동선 break 금지(§16-4b INV1 예외격리).
  BEGIN
    INSERT INTO public.phi_access_log
      (accessed_by,  accessed_role,        access_type,           customer_id,   clinic_id)
    VALUES
      (auth.uid(),   current_user_role(),  'rrn_clipboard_copy',  p_customer_id, v_clinic_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'phi_access_log insert skipped: %', SQLERRM;
  END;
END;
$$;

-- §16-4c: 기본 PUBLIC EXECUTE 회수 + authenticated 만
REVOKE EXECUTE ON FUNCTION public.log_rrn_clipboard_copy(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.log_rrn_clipboard_copy(uuid) TO authenticated;

COMMENT ON FUNCTION public.log_rrn_clipboard_copy(uuid) IS
  'T-20260730-foot-RRN-CLIPBOARD-COPY-NHIS: 주민번호 클립보드 반출 감사(READ tier). phi_access_log INSERT(메타만, RRN 미저장). 인자=customer_id 1개, by/role/clinic 서버측 파생(anti-IDOR). log_nhis_eligibility_lookup 과 동일 형상.';
