-- ============================================================
-- ROLLBACK: T-20260616-foot-KOH-SPECIMENNO-FORMAT
-- 검체번호 포맷 핀 되돌리기 — 旣 KOHTEST-LIFECYCLE-PUBLISH(20260615190000) 상태로 복원.
--   next_koh_specimen_no → (uuid,date) seq 포맷 복원, publish_koh_result → 검체번호 미발화(OFF) 복원.
-- ============================================================

BEGIN;

-- ── next_koh_specimen_no 복원: (uuid,date,text) 제거 → 旣 (uuid,date) seq 포맷 재생성 ──
DROP FUNCTION IF EXISTS next_koh_specimen_no(uuid, date, text);

CREATE OR REPLACE FUNCTION next_koh_specimen_no(p_clinic uuid, p_base_date date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefix text := to_char(p_base_date, 'YYYYMMDD');
  v_seq int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('koh_spec_no:' || p_clinic::text || ':' || v_prefix));
  SELECT count(*) + 1 INTO v_seq
    FROM form_submissions fs
    JOIN form_templates ft ON ft.id = fs.template_id
   WHERE ft.form_key = 'koh_result'
     AND fs.clinic_id = p_clinic
     AND fs.status = 'published'
     AND COALESCE(fs.field_data->>'specimen_no', '') LIKE v_prefix || '%';
  RETURN v_prefix || lpad(v_seq::text, 3, '0');
END;
$$;

COMMENT ON FUNCTION next_koh_specimen_no(uuid, date) IS
  '균검사 검체번호 자동채번(격리 보존, default OFF). DA: 외부랩 부여 충돌 차단 위해 publish 시 미호출. 원내 자체수행 확정 시 ON 토글. (T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH)';

-- ── publish_koh_result 복원: 검체번호 미발화(OFF), phone 조회 제거 ──
CREATE OR REPLACE FUNCTION publish_koh_result(p_check_in_service_id uuid, p_field_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clinic     uuid;
  v_customer   uuid;
  v_checkin    uuid;
  v_nail_sites jsonb;
  v_base_date  date;
  v_template   uuid;
  v_staff      uuid;
  v_request_no text;
  v_field      jsonb;
  v_new_id     uuid;
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

  v_request_no := next_koh_request_no(v_clinic, v_base_date);
  -- v_specimen_no := next_koh_specimen_no(v_clinic, v_base_date); -- [OFF] DA 후속 통지 시 ON

  v_field := COALESCE(p_field_data, '{}'::jsonb)
    || jsonb_build_object(
         'request_no',     v_request_no,
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
    'specimen_no', COALESCE(v_field->>'specimen_no', '')
  );
END;
$$;

COMMENT ON FUNCTION publish_koh_result(uuid, jsonb) IS
  '균검사 결과지 발행(AC-4/AC-5). 비가역(중복발행 차단)+자동채번+published insert. 연결키=field_data.koh_service_id(스키마 무변경). (T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH)';

REVOKE ALL ON FUNCTION publish_koh_result(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publish_koh_result(uuid, jsonb) TO authenticated;

COMMIT;
