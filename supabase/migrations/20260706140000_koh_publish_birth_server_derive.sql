-- ============================================================
-- T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST  (Path A)
-- 균검사 결과지 발행 RPC — 생년월일(birth_date) 서버파생 주입.
-- ============================================================
-- 배경: 결과지 문서표면(문서 3경로: 진료대시보드/치료테이블/미리보기)의 birth_date 바인딩이
--   FE payload(effectiveBirth) 계산 경로 유무에 따라 불일치(BINDING-INCONSIST). 발행 시점에
--   서버가 확정 파생해 field_data.birth_date 스냅샷을 채워 3경로 공통 정상 표시를 보장한다.
--
-- data-architect CONSULT-REPLY(MSG-20260706-135616-hw9w): GO · ADDITIVE · 대표 게이트 불요.
--   DB 변경 = publish_koh_result RPC 본체만(테이블/컬럼/enum 무변경) → 파괴요소 0, supervisor 함수-diff.
--
-- 旣 phone/의뢰번호/검체번호 서버파생과 parity — RPC 내부에서 파생값을 확보해 field_data 병합.
--   birth 파생은 fn_customer_birthdates(20260613120000) 재사용 = 세기휴리스틱 SSOT 단일화
--   (인라인 복제 시 파생 로직 drift 위험 → BINDING-INCONSIST 재유발. 재사용이 본 티켓 목적에 정합).
--
-- 하드 AC (DA GO의 전제 — 위반 시 supervisor qa-fail):
--   AC7 [COALESCE 순서] : COALESCE(server_derived, FE_payload_birth) — 서버파생 우선, FE payload fallback.
--                         서버파생 NULL이면 FE effectiveBirth 유지(회귀 0). 역순(FE 우선) 절대 금지.
--   AC8 [AC-PHI]        : field_data엔 파생 표시값(YYYY-MM-DD → 결과지 렌더포맷)만 적재.
--                         세기코드 중간값·RRN 평문·뒷자리 스냅샷 기록 금지. fn_customer_birthdates가
--                         birth_date_display(YYYY-MM-DD)만 반환(RRN 미노출) → RPC는 그 값만 수신.
--   AC9 [AC-GRANT]      : publish_koh_result(SECURITY DEFINER) 실행 role = 함수 owner(postgres) =
--                         fn_customer_birthdates owner(postgres) 동일 → implicit EXECUTE.
--                         fn_customer_birthdates anon EXECUTE 회수는 20260613120000 유지(본 마이그 미변경).
--   AC10 [AC-MERGEKEY]  : write는 field_data.birth_date(스냅샷)뿐. customers.birth_date(TEXT 'YYMMDD'
--                         병합키)로 역기록 절대 금지 — 병합키 파괴. 본 RPC는 customers를 SELECT만.
--                         스냅샷 저장 포맷 = 기존 결과지 렌더 포맷('YYYY년 MM월 DD일', formatBirthKo 동형)
--                         유지 → 포맷 회귀 방지.
--   AC4 [RRN 미표기]    : birth만 복구. RRN 재노출 0(fn_customer_birthdates가 RRN 평문 미반환).
--
-- 스코프: Path A(신규 발행분 항구책)만. 기발행(legacy) 소급 backfill 금지(의료법 §22) → form_submissions
--   불변. 발행 write 시점(스냅샷 생성)에만 서버파생을 채운다. 기발행 UPDATE·트리거 없음.
--
-- 멱등: CREATE OR REPLACE(시그니처 무변경) → 재실행 안전. 롤백: 동명 .rollback.sql.
-- ============================================================

BEGIN;

-- ── 旣 publish_koh_result(20260616180000) 동형 유지 — birth_date 서버파생 1점만 추가 ──
CREATE OR REPLACE FUNCTION publish_koh_result(p_check_in_service_id uuid, p_field_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clinic        uuid;
  v_customer      uuid;
  v_checkin       uuid;
  v_nail_sites    jsonb;
  v_base_date     date;
  v_template      uuid;
  v_staff         uuid;
  v_request_no    text;
  v_phone         text;
  v_phone_last4   text;
  v_specimen_no   text;
  v_birth_display text;   -- fn_customer_birthdates 파생값(YYYY-MM-DD). PHI: RRN/세기코드 미수신.
  v_birth_ko      text;   -- 결과지 렌더 포맷('YYYY년 MM월 DD일') 스냅샷값.
  v_field         jsonb;
  v_new_id        uuid;
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

  -- ★ birth_date 서버파생(BINDING-INCONSIST Path A) — fn_customer_birthdates 재사용.
  --   AC8: birth_date_display(YYYY-MM-DD)만 수신(RRN/세기코드/뒷자리 미노출).
  --   AC9: SECURITY DEFINER owner(postgres) implicit EXECUTE — anon 회수는 원함수 유지.
  --   파생 실패/결측 → v_birth_display NULL → 아래 COALESCE 로 FE payload fallback(회귀 0).
  SELECT birth_date_display INTO v_birth_display
    FROM fn_customer_birthdates(v_clinic, ARRAY[v_customer]::uuid[]);

  -- AC10: 스냅샷 저장 포맷 = 결과지 렌더 포맷('YYYY년 MM월 DD일', formatBirthKo 동형). 포맷 회귀 방지.
  --   customers.birth_date(병합키)로 역기록 없음 — v_birth_ko는 field_data 스냅샷 전용 파생 로컬값.
  IF v_birth_display ~ '^\d{4}-\d{2}-\d{2}' THEN
    v_birth_ko := substr(v_birth_display, 1, 4) || '년 '
               || substr(v_birth_display, 6, 2) || '월 '
               || substr(v_birth_display, 9, 2) || '일';
  ELSE
    v_birth_ko := NULL;  -- 파생값 없음 → FE payload fallback
  END IF;

  -- AC-2: 의뢰번호 + 검체번호(활성) 자동채번. 검체번호 = K+YYMMDD-폰뒷4(총괄 확정 포맷).
  v_request_no  := next_koh_request_no(v_clinic, v_base_date);
  v_specimen_no := next_koh_specimen_no(v_clinic, v_base_date, v_phone_last4);

  -- field_data 병합: FE 표시필드 + 의뢰번호/검체번호(자동) + birth(서버파생) + 연결키 + 기관 고정값.
  --   AC7: birth_date = COALESCE(서버파생, FE payload birth, '') — 서버파생 우선, FE fallback. 역순 금지.
  --   || 우변이 병합 우선 → 서버파생값이 FE payload를 override(서버 확정 스냅샷).
  v_field := COALESCE(p_field_data, '{}'::jsonb)
    || jsonb_build_object(
         'request_no',     v_request_no,
         'specimen_no',    v_specimen_no,
         'request_org',    '오블리브의원',
         'birth_date',     COALESCE(v_birth_ko, p_field_data->>'birth_date', ''),
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
  '균검사 결과지 발행(AC-4/AC-5). 비가역+자동채번(의뢰번호 YYYYMMDD+seq, 검체번호 K+YYMMDD-폰뒷4)+published insert. phone 뒷4·birth_date = RPC 내부 서버파생(PHI FE 비노출). birth_date = fn_customer_birthdates 재사용(COALESCE 서버파생>FE payload), 결과지 렌더포맷 스냅샷. 연결키=field_data.koh_service_id. (T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST)';

REVOKE ALL ON FUNCTION publish_koh_result(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publish_koh_result(uuid, jsonb) TO authenticated;

-- ── 검증 ──
DO $verify$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname = 'publish_koh_result' LIMIT 1))
    INTO v_def;

  -- AC: birth 서버파생 호출 존재
  IF v_def !~ 'fn_customer_birthdates' THEN
    RAISE EXCEPTION 'publish_koh_result: fn_customer_birthdates 서버파생 호출 누락';
  END IF;
  -- AC7: birth_date 가 override jsonb_build_object 병합에 포함(서버파생 우선)
  IF v_def !~ 'birth_date' THEN
    RAISE EXCEPTION 'publish_koh_result: birth_date 병합 누락';
  END IF;
  -- AC7 역순 금지 가드: COALESCE(v_birth_ko, ... ) 순서 확인 (FE 우선 금지)
  IF v_def !~ 'COALESCE\(v_birth_ko' THEN
    RAISE EXCEPTION 'publish_koh_result: COALESCE 순서 위반(서버파생 우선 아님)';
  END IF;
  -- AC10 병합키 파괴 가드: customers.birth_date 로의 UPDATE/역기록 부재
  IF v_def ~* 'UPDATE\s+customers' THEN
    RAISE EXCEPTION 'publish_koh_result: customers UPDATE 금지(병합키 파괴)';
  END IF;

  RAISE NOTICE 'T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST: birth 서버파생 주입 검증 통과';
END
$verify$;

COMMIT;
