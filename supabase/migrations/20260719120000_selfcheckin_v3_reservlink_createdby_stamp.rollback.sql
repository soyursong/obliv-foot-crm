-- T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON ROLLBACK — 스탬프-前 prod 정의(2026-07-19 verbatim) 복원
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v3(p_clinic_id uuid, p_name text, p_phone text, p_visit_type text, p_sms_opt_in boolean DEFAULT NULL::boolean, p_birth_date text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_postal_code text DEFAULT NULL::text, p_address_detail text DEFAULT NULL::text, p_customer_email text DEFAULT NULL::text, p_privacy_consent boolean DEFAULT NULL::boolean, p_hira_consent boolean DEFAULT NULL::boolean, p_consent_sensitive boolean DEFAULT NULL::boolean, p_consent_agreed_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_consent_version text DEFAULT NULL::text)
 RETURNS TABLE(customer_id uuid, link_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name   TEXT := NULLIF(btrim(p_name), '');
  v_digits TEXT := regexp_replace(COALESCE(p_phone,''),'\D','','g');
  v_canon  TEXT;
  v_count  INT;
  v_id     UUID;
BEGIN
  IF p_clinic_id IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'invalid input';
  END IF;

  -- canonical national digits (phoneCanonDigits 미러): 0…→82…, 82… 유지. 8자리 미만은 비교근거 제외(NULL).
  v_canon := CASE
    WHEN length(v_digits) < 8 THEN NULL
    WHEN v_digits LIKE '0%'  THEN '82' || substring(v_digits FROM 2)
    WHEN v_digits LIKE '82%' THEN v_digits
    ELSE v_digits
  END;

  -- ── 복합키 [성함 AND 연락처 canonical] 매칭 (연락처 가용 시에만; 외국인 email-only 는 매칭 skip) ──
  IF v_canon IS NOT NULL THEN
    SELECT count(*) INTO v_count
      FROM customers c
     WHERE c.clinic_id = p_clinic_id
       AND c.name = v_name
       AND ( CASE
               WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
                 THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
               ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
             END ) = v_canon;

    IF v_count >= 2 THEN
      -- 2건+ = 성함+연락처 동시중복 → 어느 차트가 본인인지 단정 불가. 자동연결·신규생성 모두 보류.
      RETURN QUERY SELECT NULL::uuid, 'ambiguous'::text;
      RETURN;

    ELSIF v_count = 1 THEN
      SELECT c.id INTO v_id
        FROM customers c
       WHERE c.clinic_id = p_clinic_id
         AND c.name = v_name
         AND ( CASE
                 WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
                   THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
                 ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
               END ) = v_canon
       LIMIT 1;

      -- 전달된 값만 멱등 persist(COALESCE 보존). NULL=미변경 / true→값+_at=now() / false→값+_at=NULL.
      UPDATE customers SET
        sms_opt_in         = COALESCE(p_sms_opt_in, sms_opt_in),
        sms_opt_in_at      = CASE WHEN p_sms_opt_in IS TRUE THEN now()
                                  WHEN p_sms_opt_in IS FALSE THEN NULL ELSE sms_opt_in_at END,
        customer_email     = COALESCE(NULLIF(btrim(p_customer_email),''), customer_email),
        birth_date         = COALESCE(NULLIF(btrim(p_birth_date),''), birth_date),
        address            = COALESCE(NULLIF(btrim(p_address),''), address),
        postal_code        = COALESCE(NULLIF(btrim(p_postal_code),''), postal_code),
        address_detail     = COALESCE(NULLIF(btrim(p_address_detail),''), address_detail),
        privacy_consent    = COALESCE(p_privacy_consent, privacy_consent),
        privacy_consent_at = CASE WHEN p_privacy_consent IS TRUE THEN now()
                                  WHEN p_privacy_consent IS FALSE THEN NULL ELSE privacy_consent_at END,
        hira_consent       = COALESCE(p_hira_consent, hira_consent),
        hira_consent_at    = CASE WHEN p_hira_consent IS TRUE THEN now()
                                  WHEN p_hira_consent IS FALSE THEN NULL ELSE hira_consent_at END,
        -- ── resolve_v3 민감정보 동의 (개보법 §23) — no-downgrade + 최초기록 보존(main 미러) ──
        consent_sensitive  = CASE WHEN p_consent_sensitive IS TRUE THEN true
                                  ELSE consent_sensitive END,
        consent_agreed_at  = CASE WHEN p_consent_sensitive IS TRUE
                                    THEN COALESCE(consent_agreed_at, p_consent_agreed_at, now())
                                  ELSE consent_agreed_at END,
        consent_version    = CASE WHEN p_consent_sensitive IS TRUE
                                    THEN COALESCE(consent_version, p_consent_version, 'foot-2026-06')
                                  ELSE consent_version END
       WHERE id = v_id;

      RETURN QUERY SELECT v_id, 'linked'::text;
      RETURN;
    END IF;
    -- v_count = 0 → INSERT 분기로 폴스루
  END IF;

  -- ── 0건(또는 연락처 미가용) → 신규 INSERT. NOT NULL 컬럼(privacy/hira/sms)은 COALESCE 기본값 보정. ──
  INSERT INTO customers(
    clinic_id, name, phone, visit_type,
    sms_opt_in, sms_opt_in_at, customer_email,
    birth_date, address, postal_code, address_detail,
    privacy_consent, privacy_consent_at, hira_consent, hira_consent_at,
    consent_sensitive, consent_agreed_at, consent_version
  ) VALUES (
    p_clinic_id, v_name, NULLIF(p_phone,''),
    CASE WHEN p_visit_type = 'new' THEN 'new' ELSE 'returning' END,
    COALESCE(p_sms_opt_in, true),
    CASE WHEN p_sms_opt_in IS TRUE THEN now() ELSE NULL END,
    NULLIF(btrim(p_customer_email),''),
    NULLIF(btrim(p_birth_date),''),
    NULLIF(btrim(p_address),''),
    NULLIF(btrim(p_postal_code),''),
    NULLIF(btrim(p_address_detail),''),
    COALESCE(p_privacy_consent, false),
    CASE WHEN p_privacy_consent IS TRUE THEN now() ELSE NULL END,
    COALESCE(p_hira_consent, false),
    CASE WHEN p_hira_consent IS TRUE THEN now() ELSE NULL END,
    -- resolve_v3: sensitive=true 시에만 동의셋 기록(DB DEFAULT FALSE 고수 — 미동의 허위기록 방지).
    COALESCE(p_consent_sensitive, false),
    CASE WHEN p_consent_sensitive IS TRUE THEN COALESCE(p_consent_agreed_at, now()) ELSE NULL END,
    CASE WHEN p_consent_sensitive IS TRUE THEN COALESCE(p_consent_version, 'foot-2026-06') ELSE NULL END
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, 'created'::text;
  RETURN;

EXCEPTION WHEN unique_violation THEN
  -- 동시 INSERT 경합 → 복합키 재조회. 못 찾으면 raise(데이터 무결성 위반 표면화).
  IF v_canon IS NOT NULL THEN
    SELECT c.id INTO v_id
      FROM customers c
     WHERE c.clinic_id = p_clinic_id
       AND c.name = v_name
       AND ( CASE
               WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
                 THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
               ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
             END ) = v_canon
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1;
  END IF;
  IF v_id IS NULL THEN RAISE; END IF;
  RETURN QUERY SELECT v_id, 'linked'::text;
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.self_checkin_with_reservation_link(p_clinic_id uuid, p_customer_payload jsonb, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today           DATE    := COALESCE(p_today, (now() AT TIME ZONE 'Asia/Seoul')::date);
  v_name            TEXT    := NULLIF(trim(p_customer_payload->>'name'), '');
  v_phone           TEXT    := NULLIF(p_customer_payload->>'phone', '');
  v_phone_e164      TEXT    := NULLIF(p_customer_payload->>'phone_e164', '');
  v_phone_digits    TEXT    := NULLIF(regexp_replace(COALESCE(p_customer_payload->>'phone',''), '[^0-9]', '', 'g'), '');
  v_phone_canon     TEXT;   -- canonical national digits (앞 0 → 82) — 포맷 무관 비교용
  v_match_count     INTEGER;
  v_visit_type      TEXT    := COALESCE(NULLIF(p_customer_payload->>'visit_type', ''), 'new');
  v_sms_opt_in      BOOLEAN := COALESCE((p_customer_payload->>'sms_opt_in')::boolean, true);
  v_birth_date      DATE    := NULLIF(p_customer_payload->>'birth_date', '')::date;
  v_address         TEXT    := NULLIF(p_customer_payload->>'address', '');
  v_privacy_consent BOOLEAN := NULLIF(p_customer_payload->>'privacy_consent', '')::boolean;
  v_notes           JSONB   := p_customer_payload->'notes';
  v_customer_id     UUID    := NULLIF(p_customer_payload->>'customer_id', '')::uuid;
  v_reservation_id  UUID    := NULLIF(p_customer_payload->>'reservation_id', '')::uuid;
  v_ci_status       TEXT;
  v_queue           INTEGER;
  v_check_in_id     UUID;
  v_existing_id     UUID;
  v_existing_queue  INTEGER;
  v_resv_linked     BOOLEAN := false;
  -- ── WS-A 하드닝 신규 로컬 (스키마 무변경) ──
  v_name_masked     BOOLEAN := false;   -- name 마스킹 지문(*, 예: 최***트)
  v_phone_masked    BOOLEAN := false;   -- phone 마스킹 지문(tail-only 1~7 digits, 예: 5453)
  v_masking_seen    BOOLEAN := false;   -- (a)/(c) payload 마스킹 지문 감지
  v_denorm_name     TEXT;               -- (d) check_ins 저장용 — raw 또는 NULL(마스킹값 저장 금지)
  v_denorm_phone    TEXT;
  v_guard_fired     BOOLEAN := false;   -- (c) 마스킹·resolve불가 → 미연결 보류 발화
BEGIN
  IF p_clinic_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_CLINIC');
  END IF;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_NAME');
  END IF;

  -- 재진→치료대기 직행 / 초진·체험→상담대기 직행 (FE 가 ci_status 명시 전달 시 우선)
  v_ci_status := COALESCE(
    NULLIF(p_customer_payload->>'ci_status', ''),
    CASE WHEN v_visit_type = 'returning' THEN 'treatment_waiting' ELSE 'consult_waiting' END
  );

  -- canonical national digits: 010… → 8210…, 8210… 유지. (포맷 혼재 비교 — E.164/숫자/하이픈 무관)
  v_phone_canon := CASE
    WHEN v_phone_digits IS NULL THEN NULL
    WHEN v_phone_digits LIKE '0%'  THEN '82' || substring(v_phone_digits FROM 2)
    WHEN v_phone_digits LIKE '82%' THEN v_phone_digits
    ELSE v_phone_digits
  END;

  -- ── WS-A (a)/(c): payload 마스킹 지문 감지 ──
  --   name 에 '*' 포함(최***트) 또는 phone 유효자릿수 1~7(tail-only, 예: 5453) → 마스킹 표시값.
  --   실 전화(국내 canonical 11~12자리)는 v_phone_masked=false. DUMMY-*(자릿수 0) 는 마스킹 아님.
  v_name_masked  := (position('*' in v_name) > 0);
  v_phone_masked := (position('*' in COALESCE(v_phone,'')) > 0)
                    OR (v_phone_digits IS NOT NULL AND length(v_phone_digits) BETWEEN 1 AND 7);
  v_masking_seen := v_name_masked OR v_phone_masked;

  -- AC-4: 동시성 직렬화 — next_queue_number 와 동일 advisory key (트랜잭션 종료까지 보유)
  PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id::text || v_today::text));

  -- ── 1) customer 해소: raw resolve 우선(reservation_id → customer_id) · 마스킹 식별키 금지 ──
  --   WS-A (b): reservation_id 있으면 서버측 raw resolve(권위). customer_id 있으면 그 raw 사용.
  --   둘 중 하나라도 있으면 payload name/phone 으로 신규 INSERT 하지 않는다(마스킹 오염 차단).
  IF v_reservation_id IS NOT NULL THEN
    -- 예약연결 경로: reservation → customer_id(raw) 를 서버가 결정론적으로 해소.
    SELECT customer_id INTO v_customer_id
      FROM reservations
     WHERE id = v_reservation_id
       AND clinic_id = p_clinic_id
     LIMIT 1;
    -- reservation 이 있으나 customer_id 미연결(NULL)인 예약이면 v_customer_id 는 NULL 유지.
    -- 이 경우에도 payload 마스킹값으로 신규 INSERT 하지 않는다(아래 guard).

  ELSIF v_customer_id IS NOT NULL THEN
    -- 키오스크가 customer_id(raw) 를 직접 전달한 경로 — 그대로 사용(존재 확인만, 신규 INSERT 없음).
    PERFORM 1 FROM customers WHERE id = v_customer_id AND clinic_id = p_clinic_id;
    IF NOT FOUND THEN
      v_customer_id := NULL;   -- 잘못된 customer_id → 미연결(마스킹 신규생성 금지)
    END IF;

  ELSIF v_masking_seen THEN
    -- ── WS-A (c) guard: reservation_id·customer_id 둘 다 없는데 payload 가 마스킹 표시값 ──
    --   예약명단(마스킹) tap 인데 식별키 전달 실패한 케이스. 마스킹 name/phone 으로 신규
    --   customers 생성 금지 → 미연결(customer_id NULL) + denormalized NULL + 현장 재해소.
    --   ★환자를 error 로 막지 않는다(체크인은 진행). (기존 match>=2 보류 path L116-119 동형)
    v_guard_fired := true;
    -- v_customer_id NULL 유지

  ELSIF v_phone_canon IS NOT NULL THEN
    -- ── 진짜 워크인 경로(예약·customer_id 없음 + 마스킹 아님) ──
    --   기존 복합키(성함 AND 연락처) 매칭 보존 — T-20260617-foot-CHECKIN-CHART-LINK-3KEY AC-1.
    SELECT count(*) INTO v_match_count
      FROM customers
     WHERE clinic_id = p_clinic_id
       AND name = v_name
       AND ( CASE
               WHEN regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE '0%'
                 THEN '82' || substring(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') FROM 2)
               ELSE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')
             END ) = v_phone_canon;

    IF v_match_count = 1 THEN
      SELECT id INTO v_customer_id
        FROM customers
       WHERE clinic_id = p_clinic_id
         AND name = v_name
         AND ( CASE
                 WHEN regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE '0%'
                   THEN '82' || substring(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') FROM 2)
                 ELSE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')
               END ) = v_phone_canon
       LIMIT 1;
      UPDATE customers SET sms_opt_in = v_sms_opt_in WHERE id = v_customer_id;
    ELSIF v_match_count = 0 THEN
      -- 신규 환자 → INSERT (genuine new patient — 기존 동작 보존, 회귀0)
      INSERT INTO customers (clinic_id, name, phone, visit_type, sms_opt_in, birth_date, address, privacy_consent)
      VALUES (
        p_clinic_id, v_name, COALESCE(v_phone, v_phone_e164),
        CASE WHEN v_visit_type = 'returning' THEN 'returning' ELSE 'new' END,
        v_sms_opt_in, v_birth_date, v_address, COALESCE(v_privacy_consent, false)
      )
      RETURNING id INTO v_customer_id;
    ELSE
      -- v_match_count >= 2: 성함+연락처 동시중복 → 임의 자동연결/신규생성 보류(미연결).
      NULL;
    END IF;
  END IF;

  -- ── 1.5) WS-A (d): denormalized 성함/연락처 결정 — 마스킹값 저장 금지 ──
  --   resolve 된 customer 있으면 raw(customers) 로, 없으면(미연결/마스킹) NULL 로 저장.
  IF v_customer_id IS NOT NULL THEN
    SELECT name, phone INTO v_denorm_name, v_denorm_phone
      FROM customers WHERE id = v_customer_id;
  ELSIF v_masking_seen THEN
    -- 마스킹 표시값은 절대 denormalized 로 남기지 않는다(오염 방지).
    -- ⚠ check_ins.customer_name 은 NOT NULL(초기스키마) → NULL 저장 시 not_null_violation 으로
    --   함수가 에러 → 환자 hard-block(DA (c) 위반). 따라서 name 은 마스킹값도 아니고 PII 도 아닌
    --   고정 sentinel('미확인')로 저장(현장 재해소 신호는 unlinked_masking_hold=true). phone 은 nullable → NULL.
    v_denorm_name  := '미확인';
    v_denorm_phone := NULL;
  ELSE
    -- 미연결이나 마스킹 아님(진짜 워크인 2건+ 보류 등) → 입력 raw 보존.
    v_denorm_name  := v_name;
    v_denorm_phone := v_phone;
  END IF;

  -- ── 2) 예약 매칭: FE-resolved 우선, 없으면 (customer_id+today+clinic+confirmed) 내부 조회 ──
  IF v_reservation_id IS NULL AND v_customer_id IS NOT NULL THEN
    SELECT id INTO v_reservation_id
      FROM reservations
     WHERE clinic_id = p_clinic_id
       AND customer_id = v_customer_id
       AND reservation_date = v_today
       AND status = 'confirmed'
     ORDER BY reservation_time ASC
     LIMIT 1;
  END IF;

  -- ── 2.5) 멱등/중복 방어: 당일(KST) 활성 체크인 존재 시 신규 발번 없이 기존 반환 ──
  SELECT id, queue_number INTO v_existing_id, v_existing_queue
    FROM check_ins
   WHERE clinic_id = p_clinic_id
     AND status <> 'cancelled'
     AND (created_at AT TIME ZONE 'Asia/Seoul')::date = v_today
     AND (
       (v_reservation_id IS NOT NULL AND reservation_id = v_reservation_id)
       OR (v_customer_id IS NOT NULL AND customer_id = v_customer_id)
     )
   ORDER BY created_at ASC
   LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true, 'already_checked_in', true,
      'check_in_id', v_existing_id, 'queue_number', v_existing_queue,
      'reservation_id', v_reservation_id,
      'reservation_linked', (v_reservation_id IS NOT NULL),
      'customer_id', v_customer_id
    );
  END IF;

  -- ── 3) queue 발번 (advisory lock 보유 상태) ──
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue
    FROM check_ins
   WHERE clinic_id = p_clinic_id
     AND checked_in_at::date = v_today;

  -- ── 4) check_ins INSERT (reservation_id 연결) — denormalized 는 raw/NULL(WS-A (d)) ──
  BEGIN
    INSERT INTO check_ins (
      clinic_id, customer_id, customer_name, customer_phone,
      visit_type, status, queue_number, notes, reservation_id
    ) VALUES (
      p_clinic_id, v_customer_id, v_denorm_name, v_denorm_phone,
      v_visit_type, v_ci_status, v_queue, v_notes, v_reservation_id
    )
    RETURNING id INTO v_check_in_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'duplicate', true,
                              'error_code', 'DUPLICATE_CHECKIN_TODAY');
  END;

  -- ── 5) 예약 매칭 시 status 전이 (SECURITY DEFINER → anon RLS 우회, AC-1/AC-5) ──
  IF v_reservation_id IS NOT NULL THEN
    UPDATE reservations
       SET status = 'checked_in', updated_at = now()
     WHERE id = v_reservation_id AND status = 'confirmed';
    v_resv_linked := true;
  END IF;

  -- ── 6) status_transitions lifecycle 1건 (AC-3) ──
  INSERT INTO status_transitions (check_in_id, clinic_id, from_status, to_status, changed_by)
  VALUES (v_check_in_id, p_clinic_id, 'registered', v_ci_status, 'self_checkin');

  RETURN jsonb_build_object(
    'success', true,
    'check_in_id', v_check_in_id,
    'queue_number', v_queue,
    'customer_id', v_customer_id,
    'reservation_id', v_reservation_id,
    'reservation_linked', COALESCE(v_resv_linked, false),
    -- WS-A: 마스킹·미연결 보류 발화 신호(키오스크/현장 안내용 — 환자 차단 아님)
    'unlinked_masking_hold', v_guard_fired
  );
END;
$function$;

COMMIT;
