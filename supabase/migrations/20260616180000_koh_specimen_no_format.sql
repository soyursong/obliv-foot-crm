-- ============================================================
-- T-20260616-foot-KOH-SPECIMENNO-FORMAT
-- 균배양 검사 결과지 검체번호 자동배정 — 총괄 확정 포맷 핀(format pin).
-- ============================================================
-- 旣 KOHTEST-LIFECYCLE-PUBLISH(20260615190000) 구현 살림 — 그 위 포맷 수정·호출 활성. 재작업 X.
--   data-architect ADDITIVE-GO(KOHTEST-LIFECYCLE) 스코프 = 자동채번 메커니즘. 본건은 포맷 핀이라
--   신규 DA CONSULT 불요. DB 변경 = RPC body/시그니처만(테이블 무변경) → 대표 게이트 면제, supervisor DDL-diff.
--
-- 확정 포맷(총괄): K + YYMMDD(6자리) + '-' + 고객 폰 뒷4자리   예: K260616-1234
--   중복 정책: 같은 날 폰뒷4 충돌 OK → UNIQUE 제약/회피 로직 두지 말 것(공란없음이 목표).
--
-- 본 마이그 = RPC 본체/시그니처만. 테이블/컬럼/enum 무변경 → 파괴요소 0.
--   AC-1: next_koh_specimen_no(uuid,date) → next_koh_specimen_no(uuid,date,text) 로 시그니처 교체.
--          기존 YYYYMMDD+3자리seq 포맷·advisory lock·count seq 로직 제거. 미호출이라 콜러 회귀 0.
--   AC-2: publish_koh_result 의 주석된 next_koh_specimen_no 호출 활성(+ phone 뒷4 전달).
--   AC-3: publish_koh_result 내부 customers 조회로 phone 뒷4 확보(FE payload 확장 X, PHI FE 비노출).
--          phone 미등록/4자리 미만 = 안전 패딩('0' lpad), 발행 막지 않음.
--
-- 롤백: 20260616180000_koh_specimen_no_format.rollback.sql
-- ============================================================

BEGIN;

-- ── AC-1: 검체번호 자동채번 시그니처 교체 ──
--   시그니처 변경(인자 추가) → CREATE OR REPLACE 불가(오버로드 발생). 旣 (uuid,date) DROP 후 신규 CREATE.
--   旣 함수는 publish_koh_result 에서 주석(미호출) → 콜러 회귀 0(티켓 명시).
DROP FUNCTION IF EXISTS next_koh_specimen_no(uuid, date);

--   포맷 = 'K' || YYMMDD(검체채취일) || '-' || 폰뒷4. seq/lock/count 없음(중복 허용, 공란없음이 목표).
--   p_clinic = 시그니처 일관성/미래 확장 위해 보존(현재 미사용). 테이블 무접근 → STABLE 순수 포맷 함수.
CREATE OR REPLACE FUNCTION next_koh_specimen_no(p_clinic uuid, p_base_date date, p_phone_last4 text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'K' || to_char(p_base_date, 'YYMMDD') || '-' || p_phone_last4;
$$;

COMMENT ON FUNCTION next_koh_specimen_no(uuid, date, text) IS
  '균검사 검체번호 자동채번 = K+YYMMDD(검체채취일)+''-''+폰뒷4. 총괄 확정 포맷(T-20260616-foot-KOH-SPECIMENNO-FORMAT). 같은날 폰뒷4 충돌 허용(공란없음 목표, UNIQUE/seq 없음). p_clinic=시그니처 일관성 위해 보존(현재 미사용).';

-- ── AC-2/AC-3: 발행 RPC — 검체번호 자동채번 활성 + phone 뒷4 RPC 내부 확보 ──
--   旣 publish_koh_result(20260615190000) 동형 유지 — 검체번호 활성 + phone 조회 2점만 변경.
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

  -- 대상 KOH 검사행 → clinic/customer/check_in/검체종류/검체채취일 해석.
  --   검체채취일(=진료일) = cis.created_at(KST) — 의뢰번호/검체번호 일자 base(insert 시각 아님).
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

  -- AC-3: 검체종류(채취 조갑부위) 필수 — 미선택 발행 차단
  IF jsonb_typeof(v_nail_sites) <> 'array' OR jsonb_array_length(v_nail_sites) = 0 THEN
    RAISE EXCEPTION '채취 조갑부위(검체종류)를 먼저 선택해야 발행할 수 있습니다' USING ERRCODE = '23514';
  END IF;

  -- 결과지 템플릿
  SELECT id INTO v_template
    FROM form_templates
   WHERE clinic_id = v_clinic AND form_key = 'koh_result' AND active = true
   LIMIT 1;
  IF v_template IS NULL THEN
    RAISE EXCEPTION 'koh_result form_template not found for clinic %', v_clinic;
  END IF;

  -- AC-5: 비가역 — 이미 발행(published)된 KOH 검사행이면 재발행 차단
  IF EXISTS (
    SELECT 1 FROM form_submissions
     WHERE template_id = v_template
       AND status = 'published'
       AND field_data->>'koh_service_id' = p_check_in_service_id::text
  ) THEN
    RAISE EXCEPTION '이미 발행된 검사입니다. 발행은 취소·수정할 수 없습니다(비가역).' USING ERRCODE = '23505';
  END IF;

  -- issued_by = staff.id (≠ user_profiles.id), auth.uid() 경유.
  SELECT id INTO v_staff FROM staff WHERE user_id = auth.uid() LIMIT 1;

  -- AC-3: phone 뒷4 확보 — RPC 내부 customers 조회(FE payload 확장 X, PHI FE 비노출).
  --   숫자만 추출 후 우측 4자리. 미등록/4자리 미만 = 안전 패딩(lpad '0'), 발행 막지 않음(공란없음 목표).
  SELECT phone INTO v_phone FROM customers WHERE id = v_customer;
  v_phone_last4 := right(regexp_replace(COALESCE(v_phone, ''), '[^0-9]', '', 'g'), 4);
  IF length(v_phone_last4) < 4 THEN
    v_phone_last4 := lpad(v_phone_last4, 4, '0');  -- '' → '0000', '123' → '0123'
  END IF;

  -- AC-2: 의뢰번호 + 검체번호(활성) 자동채번. 검체번호 = K+YYMMDD-폰뒷4(총괄 확정 포맷).
  v_request_no  := next_koh_request_no(v_clinic, v_base_date);
  v_specimen_no := next_koh_specimen_no(v_clinic, v_base_date, v_phone_last4);

  -- field_data 병합: FE 표시필드 + 의뢰번호/검체번호(자동) + 연결키 + 기관 고정값.
  --   specimen_no = RPC 자동값으로 override(FE 빈값 무시). 공란없음 목표.
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

-- ── 검증 ──
DO $verify$
DECLARE
  v_test text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.proname = 'next_koh_specimen_no'
       AND pg_get_function_identity_arguments(p.oid) = 'p_clinic uuid, p_base_date date, p_phone_last4 text'
  ) THEN RAISE EXCEPTION 'next_koh_specimen_no(uuid,date,text) 시그니처 교체 실패'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.proname = 'next_koh_specimen_no'
       AND pg_get_function_identity_arguments(p.oid) = 'p_clinic uuid, p_base_date date'
  ) THEN RAISE EXCEPTION '旣 next_koh_specimen_no(uuid,date) 미제거(DROP 실패)'; END IF;

  -- 포맷 단위 검증
  v_test := next_koh_specimen_no('00000000-0000-0000-0000-000000000000'::uuid, '2026-06-16'::date, '1234');
  IF v_test <> 'K260616-1234' THEN
    RAISE EXCEPTION '검체번호 포맷 불일치: 기대 K260616-1234, 실제 %', v_test;
  END IF;

  RAISE NOTICE 'T-20260616-foot-KOH-SPECIMENNO-FORMAT: 검체번호 포맷 핀 검증 통과 (%)', v_test;
END
$verify$;

COMMIT;
