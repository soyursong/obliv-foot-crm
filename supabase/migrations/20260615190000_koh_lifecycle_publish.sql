-- ============================================================
-- T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH
-- 균검사지 라이프사이클 (KOH 신청→리스트업→발행→결과지·차트연동)
-- ============================================================
-- data-architect CONSULT-REPLY(MSG-20260615-125238-lfmy) 정본 스키마 4건 = 전부 ADDITIVE.
--   대표 게이트 면제(autonomy §3.1), supervisor DDL-diff 게이트만.
--   기존 KOHSHEET-NAILSYNC-CHARTOPEN(0768607)·koh_nail_sites(20260612160000) 무손상 — 그 위 확장.
--
-- 본 마이그 = ADDITIVE only. 파괴요소(DROP·타입변경·기존 enum 제거) 0.
--   1. check_in_services.koh_requested boolean (AC-1) — DEFAULT false 백필, 회귀 0
--   2. set_koh_requested RPC (AC-1) — set_koh_nail_sites 동형(승인사용자·한 필드)
--   3. form_submissions.status CHECK 에 'published' 추가 (AC-3/AC-5) — ADDITIVE CHECK
--   4. koh_result form_template seed (AC-4) — OPINIONCERT 패턴(html+field_map)
--   5. publish_koh_result RPC (AC-4/AC-5) — 자동채번 + 발행(비가역) atomic insert
--
-- ✅ 자동채번 포맷 확정 — data-architect FOLLOWUP-REPLY(2026-06-15 23:37, dev-foot.md L37856).
--   [Q1 의뢰번호] YYYYMMDD + 3자리 per-day 일련 GO. 일자 base = 검체채취일/진료일(insert 시각 아님, 자정경계=진료일).
--     reset = per-day(매일 001~), zero-pad 3자리(초과 시 자리수 자동확장). scope = foot DB 전역.
--   [Q2 검체번호] default OFF, nullable manual-input 출고 — 외부랩 부여 가능성(dual-identity 사고 차단).
--     자동채번 RPC 보존하되 publish 시 미발화. 원내 자체수행 확정 시 ON 토글(1줄). 현장확인 = DA가 responder 라우팅.
--   [Q3 dedup] UNIQUE(의뢰번호)/per-day. 동시성 = pg_advisory_xact_lock(hashtext(검체채취일)) 직렬화.
--
-- 롤백: 20260615190000_koh_lifecycle_publish.rollback.sql
-- ============================================================

BEGIN;

-- ── 1. AC-1: KOH 신청 플래그 (check_in_services 호스트, koh_nail_sites 동일 귀속) ──
--   ADDITIVE: DEFAULT false → 기존 행 즉시 백필(전부 미신청), 신규 쓰기 무영향.
ALTER TABLE check_in_services
  ADD COLUMN IF NOT EXISTS koh_requested boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN check_in_services.koh_requested IS
  '균검사지 KOH 신청 플래그(AC-1). ON=active(균검사지 목록 활성)/OFF=inactive(행 유지·회색). 단일 boolean으로 active/inactive 표현(별도 컬럼 신설 금지, DA 권고). 2번차트 패키지탭 토글로 set_koh_requested 통해 쓰기. (T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH)';

-- ── 2. AC-1: 신청 플래그 쓰기 RPC (set_koh_nail_sites 동형 패턴) ──
--   check_in_services UPDATE RLS(consultant+) 우회 — 승인 사용자 누구나(치료사 포함) '한 필드'만.
--   가격/패키지 등 기존 쓰기 격리 무손상(테이블 RLS 확대 금지).
CREATE OR REPLACE FUNCTION set_koh_requested(p_check_in_service_id uuid, p_value boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new boolean;
BEGIN
  IF NOT is_approved_user() THEN
    RAISE EXCEPTION 'not authorized: koh_requested write requires approved user'
      USING ERRCODE = '42501';
  END IF;

  UPDATE check_in_services
     SET koh_requested = COALESCE(p_value, false)
   WHERE id = p_check_in_service_id
  RETURNING koh_requested INTO v_new;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'check_in_services row not found: %', p_check_in_service_id;
  END IF;

  RETURN v_new;
END;
$$;

COMMENT ON FUNCTION set_koh_requested(uuid, boolean) IS
  'KOH 신청 플래그 쓰기(승인 사용자 누구나, 한 필드만). check_in_services UPDATE RLS(consultant+) 우회용 정의자 RPC. set_koh_nail_sites 동형. (T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH)';

REVOKE ALL ON FUNCTION set_koh_requested(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_koh_requested(uuid, boolean) TO authenticated;

-- ── 3. AC-3/AC-5: form_submissions.status 에 'published' 추가 (ADDITIVE CHECK) ──
--   기존 = draft|printed|signed|voided|completed → +published. 기존 값/행 무영향.
ALTER TABLE form_submissions
  DROP CONSTRAINT IF EXISTS form_submissions_status_check;
ALTER TABLE form_submissions
  ADD CONSTRAINT form_submissions_status_check
  CHECK (status IN ('draft', 'printed', 'signed', 'voided', 'completed', 'published'));

COMMENT ON COLUMN form_submissions.status IS
  'form_submissions 처리 상태. draft|printed|signed|voided|completed + published(균검사 결과지 발행=비가역 확정, T-20260615 KOHTEST-LIFECYCLE-PUBLISH).';

-- ── 4. AC-4: 균검사 결과지(검사결과 보고서) form_template seed ──
--   OPINIONCERT 패턴(template_format=html + field_map). HTML 본체 = htmlFormTemplates.ts KOH_RESULT_HTML.
--   field_map = 정본 양식(검사결과지 양식.png) 필드. 검사결과 라인(보험코드/검사명/Hyphae/Yeast)은
--   양식 고정값(AC-3 '결과값 개별 입력 없음·모든 환자 동일') → field_data 미포함, 템플릿 HTML에 고정.
DO $seed$
DECLARE
  v_clinic uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8'; -- 오블리브 풋센터 종로
BEGIN
  INSERT INTO form_templates (
    clinic_id, category, form_key, name_ko,
    template_path, template_format, field_map,
    requires_signature, required_role, active, sort_order
  ) VALUES (
    v_clinic, 'foot-service', 'koh_result',
    '검사결과 보고서',
    '', 'html',
    '[
      {"key":"request_no",    "label":"의뢰번호",   "type":"text", "x":0,"y":0},
      {"key":"request_org",   "label":"의뢰기관",   "type":"text", "x":0,"y":0},
      {"key":"doctor_name",   "label":"담당의",     "type":"text", "x":0,"y":0},
      {"key":"patient_name",  "label":"수진자명",   "type":"text", "x":0,"y":0},
      {"key":"chart_number",  "label":"차트번호",   "type":"text", "x":0,"y":0},
      {"key":"birth_date",    "label":"생년월일",   "type":"text", "x":0,"y":0},
      {"key":"remark",        "label":"비고",       "type":"text", "x":0,"y":0},
      {"key":"collected_date","label":"검체채취일", "type":"text", "x":0,"y":0},
      {"key":"requested_date","label":"검사의뢰일", "type":"text", "x":0,"y":0},
      {"key":"specimen_type", "label":"검체종류",   "type":"text", "x":0,"y":0},
      {"key":"specimen_no",   "label":"검체번호",   "type":"text", "x":0,"y":0}
    ]'::jsonb,
    false, 'admin|manager|consultant|coordinator|technician|therapist', true, 110
  )
  ON CONFLICT (clinic_id, form_key) DO UPDATE SET
    name_ko         = EXCLUDED.name_ko,
    template_path   = EXCLUDED.template_path,
    template_format = EXCLUDED.template_format,
    field_map       = EXCLUDED.field_map,
    required_role   = EXCLUDED.required_role,
    active          = EXCLUDED.active,
    sort_order      = EXCLUDED.sort_order;
END
$seed$;

-- ── 5a. 의뢰번호 자동채번 — DA FOLLOWUP-REPLY 확정 포맷 ──
--   포맷 = to_char(검체채취일, 'YYYYMMDD') || 3자리 per-day 일련(001~).
--   일자 base = 검체채취일/진료일(p_base_date) — insert 시각 아님(자정경계=진료일, Q1).
--   동시성(Q3) = pg_advisory_xact_lock(hashtext(clinic|base_date)) 직렬화 → MAX+1 race 차단.
--     low-load 가정. 일련 1000건 초과 시 lpad 가 자리수 자동확장(F-#### 9999 확장 동형).
--   scope = foot 단일 클리닉 DB 전역(clinic 필터). dedup = published 의뢰번호 prefix count.
CREATE OR REPLACE FUNCTION next_koh_request_no(p_clinic uuid, p_base_date date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefix text := to_char(p_base_date, 'YYYYMMDD');
  v_seq int;
BEGIN
  -- per-day 직렬화 — 동일 (clinic, 검체채취일) 동시 발행의 MAX+1 충돌 방지(Q3 권고).
  PERFORM pg_advisory_xact_lock(hashtext('koh_req_no:' || p_clinic::text || ':' || v_prefix));

  -- 이미 발행된 결과지 중 같은 날짜 prefix 의뢰번호 개수 + 1 (per-day reset).
  SELECT count(*) + 1 INTO v_seq
    FROM form_submissions fs
    JOIN form_templates ft ON ft.id = fs.template_id
   WHERE ft.form_key = 'koh_result'
     AND fs.clinic_id = p_clinic
     AND fs.status = 'published'
     AND COALESCE(fs.field_data->>'request_no', '') LIKE v_prefix || '%';

  RETURN v_prefix || lpad(v_seq::text, 3, '0');
END;
$$;

COMMENT ON FUNCTION next_koh_request_no(uuid, date) IS
  '균검사 결과지 의뢰번호 자동채번 = YYYYMMDD(검체채취일)+3자리 per-day 일련. DA FOLLOWUP-REPLY(2026-06-15) 확정. 동시성 advisory lock. (T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH)';

-- ── 5a-2. 검체번호 자동채번 — DA: default OFF(미발화). 격리 보존, publish 시 호출 안 함 ──
--   외부랩 부여 가능성(dual-identity 사고) → CRM 자동생성 OFF, nullable manual-input 출고.
--   원내 자체수행 확정 시 publish_koh_result 에서 호출 1줄 추가로 ON 토글(본 함수 본체 재사용).
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

-- ── 5b. AC-4/AC-5: 결과지 발행 RPC (비가역 atomic) ──
--   FE(KohReportTab)가 표시필드(수진자/차트/생년/담당의/날짜/검체종류) 계산해 p_field_data 전달.
--   RPC = 권한게이트 + 비가역(중복발행 차단) + 자동채번 + issued_by 해석 + form_submission INSERT(published).
--   결과지 ↔ KOH 검사행 연결 = field_data.koh_service_id (form_submissions 신규 컬럼 신설 안 함, 스키마 무변경).
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

  -- 대상 KOH 검사행 → clinic/customer/check_in/검체종류/검체채취일 해석.
  --   검체채취일(=진료일) = cis.created_at(KST) — 의뢰번호 일자 base(DA Q1: insert 시각 아님).
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
  --   form_submissions.issued_by 는 nullable(20260522000010) — staff 미해석 시 NULL 허용(발행 차단 안 함).
  SELECT id INTO v_staff FROM staff WHERE user_id = auth.uid() LIMIT 1;

  -- 의뢰번호 자동채번(검체채취일 base). 검체번호는 DA: default OFF → 자동생성 안 함(nullable manual).
  --   원내 자체수행 확정 시 아래 1줄(next_koh_specimen_no) 주석 해제로 ON 토글.
  v_request_no := next_koh_request_no(v_clinic, v_base_date);
  -- v_specimen_no := next_koh_specimen_no(v_clinic, v_base_date); -- [OFF] DA 후속 통지 시 ON

  -- field_data 병합: FE 표시필드 + 의뢰번호(자동) + 연결키 + 기관 고정값.
  --   specimen_no = FE/수기 입력값 그대로 보존(p_field_data). 자동 override 안 함(DA Q2 OFF).
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

-- ── 검증 ──
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='check_in_services' AND column_name='koh_requested')
  THEN RAISE EXCEPTION 'koh_requested 컬럼 생성 실패'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='set_koh_requested')
  THEN RAISE EXCEPTION 'set_koh_requested RPC 생성 실패'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='publish_koh_result')
  THEN RAISE EXCEPTION 'publish_koh_result RPC 생성 실패'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='next_koh_request_no')
  THEN RAISE EXCEPTION 'next_koh_request_no RPC 생성 실패'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='next_koh_specimen_no')
  THEN RAISE EXCEPTION 'next_koh_specimen_no RPC 생성 실패'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='form_submissions_status_check'
       AND pg_get_constraintdef(oid) LIKE '%published%'
  ) THEN RAISE EXCEPTION 'form_submissions published CHECK 추가 실패'; END IF;

  RAISE NOTICE 'T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH: 스키마 4건 ADDITIVE 검증 통과';
END
$verify$;

COMMIT;
