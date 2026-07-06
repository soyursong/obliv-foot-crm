-- ============================================================
-- T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST — ROLLBACK
-- publish_koh_result birth 서버파생 되돌리기 → 旣 20260616180000(검체번호 포맷 핀) 상태 복원.
-- ============================================================
-- 직전 정의(20260616180000_koh_specimen_no_format.sql)의 publish_koh_result 를 CREATE OR REPLACE 로
-- 그대로 복원한다(시그니처 무변경 uuid,jsonb). birth 서버파생 1점만 제거 → phone/의뢰번호/검체번호는 유지.
-- 테이블/컬럼/enum 무변경 → 데이터 무손실. 멱등(CREATE OR REPLACE) 재실행 안전.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION publish_koh_result(p_check_in_service_id uuid, p_field_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clinic       uuid;
  v_customer     uuid;
  v_checkin      uuid;
  v_nail_sites   jsonb;
  v_base_date    date;
  v_template     uuid;
  v_staff        uuid;
  v_request_no   text;
  v_phone        text;
  v_phone_last4  text;
  v_specimen_no  text;
  v_field        jsonb;
  v_new_id       uuid;
BEGIN
  IF NOT is_approved_user() THEN
    RAISE EXCEPTION 'not authorized: publish requires approved user' USING ERRCODE = '42501';
  END IF;

  SELECT ci.clinic_id, ci.customer_id, cis.check_in_id,
         COALESCE(cis.koh_nail_sites, '[]'::jsonb),
         (cis.created_at AT TIME ZONE 'Asia/Seoul')::date
    INTO v_clinic, v_customer, v_checkin, v_nail_sites, v_base_date
    FROM check_in_services cis
    JOIN check_ins ci ON ci.id = cis.check_in_id
   WHERE cis.id = p_check_in_service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KOH check_in_service not found: %', p_check_in_service_id;
  END IF;
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'KOH 검사행에 고객(customer) 연결이 없어 발행할 수 없습니다';
  END IF;

  IF jsonb_typeof(v_nail_sites) <> 'array' OR jsonb_array_length(v_nail_sites) = 0 THEN
    RAISE EXCEPTION '채취 조갑부위(검체종류)를 먼저 선택해야 발행할 수 있습니다' USING ERRCODE = '23514';
  END IF;

  SELECT id INTO v_template
    FROM form_templates
   WHERE clinic_id = v_clinic AND form_key = 'koh_result' AND active = true
   LIMIT 1;
  IF v_template IS NULL THEN
    RAISE EXCEPTION 'koh_result form_template not found for clinic %', v_clinic;
  END IF;

  IF EXISTS (
    SELECT 1 FROM form_submissions
     WHERE template_id = v_template
       AND status = 'published'
       AND field_data->>'koh_service_id' = p_check_in_service_id::text
  ) THEN
    RAISE EXCEPTION '이미 발행된 검사입니다. 발행은 취소·수정할 수 없습니다(비가역).' USING ERRCODE = '23505';
  END IF;

  SELECT id INTO v_staff FROM staff WHERE user_id = auth.uid() LIMIT 1;

  SELECT phone INTO v_phone FROM customers WHERE id = v_customer;
  v_phone_last4 := right(regexp_replace(COALESCE(v_phone, ''), '[^0-9]', '', 'g'), 4);
  IF length(v_phone_last4) < 4 THEN
    v_phone_last4 := lpad(v_phone_last4, 4, '0');
  END IF;

  v_request_no  := next_koh_request_no(v_clinic, v_base_date);
  v_specimen_no := next_koh_specimen_no(v_clinic, v_base_date, v_phone_last4);

  v_field := COALESCE(p_field_data, '{}'::jsonb)
    || jsonb_build_object(
         'request_no',     v_request_no,
         'specimen_no',    v_specimen_no,
         'request_org',    '오블리브의원',
         'koh_service_id', p_check_in_service_id::text
       );

  INSERT INTO form_submissions (
    clinic_id, template_id, check_in_id, customer_id, issued_by,
    field_data, status, printed_at
  ) VALUES (
    v_clinic, v_template, v_checkin, v_customer, v_staff,
    v_field, 'published', now()
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'id', v_new_id,
    'request_no', v_request_no,
    'specimen_no', v_specimen_no
  );
END;
$$;

COMMENT ON FUNCTION publish_koh_result(uuid, jsonb) IS
  '균검사 결과지 발행(AC-4/AC-5). 비가역+자동채번(의뢰번호 YYYYMMDD+seq, 검체번호 K+YYMMDD-폰뒷4)+published insert. phone 뒷4 = RPC 내부 customers 조회(PHI FE 비노출). 연결키=field_data.koh_service_id. (T-20260616-foot-KOH-SPECIMENNO-FORMAT)';

REVOKE ALL ON FUNCTION publish_koh_result(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publish_koh_result(uuid, jsonb) TO authenticated;

COMMIT;
