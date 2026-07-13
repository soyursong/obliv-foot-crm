-- T-20260713-foot-UNAUTH-CHANGE-INVESTIGATE-ROLLBACK (WS-A): 셀프체크인 WRITE-path 하드닝 — 마스킹 payload 마스터 오염 차단
--
-- 근본원인 (DA 정본 / dev-foot 4차 포렌식 prod read-only 증거):
--   외부 키오스크 foot-checkin 은 예약명단을 fn_selfcheckin_today_reservations(147b3417, T-20260711
--   서버측 PHI 마스킹)로 읽는다 → 반환 customer_name/phone 이 이미 마스킹됨(최***트 / tail 5453).
--   키오스크는 이를 rawReservationsRef 에 raw 로 착각·주입(SelfCheckIn.tsx handleSelectReservation
--   setName(rawName)/setPhone) → 체크인 확정 시 self_checkin_with_reservation_link 로 마스킹된
--   name/phone 을 그대로 되던짐. 서버는 v_customer_id/v_reservation_id 슬롯(이미 payload 에 존재)을
--   식별키로 안 쓰고, 마스킹 name+phone 복합키 매칭 → v_match_count=0 → L107-115 마스킹 신규
--   customers INSERT → 마스터 오염. L169 check_ins denormalized 도 마스킹 저장.
--   증거(prod, 실환자0·전부 test/DUMMY): cust 512998d0 최***트/5453 ← raw 8fa12f4c 최종테스트/
--   +821099565453(38초前) · cust 0356b229 …/9089 ← raw c51dd5e0 …/+821054149089.
--
-- 하드닝 (DA 계약 (a)(b)(c)(d)):
--   (a) 매칭키 = phone canonical digits + customer_id. 마스킹 표시값(name '*' / phone tail-only)은
--       식별키로 사용 금지.
--   (b) reservation_id 있으면 → reservations.customer_id 를 서버측 raw resolve(권위 경로).
--       customer_id 있으면 → 그 raw 사용. 둘 중 하나라도 있으면 payload name/phone 으로 신규 INSERT 금지.
--       phone 복합키 fallback(신규 INSERT 가능 경로)은 reservation_id 도 customer_id 도 없는
--       '진짜 워크인' 에 한해서만.
--   (c) guard fail-mode (★환자 hard-block 금지): payload name/phone 에 마스킹 지문(name '*' /
--       phone digit 1~7자리 tail) 감지 시 →
--         · raw resolve 가능(reservation_id/customer_id) → 그 경로로 체크인 완료(환자 안 막음).
--         · resolve 불가 + 마스킹지문 → 신규 customers 생성 거부 + 미연결 check_in(denormalized NULL)
--           + 현장 재해소(기존 v_match_count>=2 보류 path L116-119 동형). error 로 막지 않음.
--   (d) denormalized 방어: check_ins.customer_name/customer_phone 에 마스킹값 저장 금지 →
--       resolve 된 raw(customers) 또는 NULL.
--
-- 분류/게이트: 비-ADDITIVE(write 동작 변경)·비-destructive → corrective write-path hardening.
--   동일 signature CREATE OR REPLACE, 롤백=직전 함수정의(20260617000000_selfcheckin_composite_key_3key).
--   CEO 게이트 면제(DA Q1) / supervisor 행위 회귀검증 5테스트 게이트 격상. 스키마 무변경(기존 컬럼만).
-- author: dev-foot / 2026-07-13 · ticket: T-20260713-foot-UNAUTH-CHANGE-INVESTIGATE-ROLLBACK · DA: DA-20260713-foot-SELFCHECKIN-WRITE-HARDEN

BEGIN;

CREATE OR REPLACE FUNCTION public.self_checkin_with_reservation_link(
  p_clinic_id        UUID,
  p_customer_payload JSONB,
  p_today            DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    -- 마스킹 표시값은 절대 denormalized 로 남기지 않는다(오염 방지) → NULL.
    v_denorm_name  := NULL;
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
$$;

GRANT EXECUTE ON FUNCTION public.self_checkin_with_reservation_link(UUID, JSONB, DATE)
  TO anon, authenticated;

COMMENT ON FUNCTION public.self_checkin_with_reservation_link IS
  'T-20260713-foot-UNAUTH WS-A: 셀프체크인 WRITE-path 하드닝. 고객해소 = reservation_id→customers(raw)'
  ' 서버resolve 우선 → customer_id(raw) → (진짜 워크인만) 성함+연락처 복합키. 마스킹 표시값(name *,'
  ' phone tail 1~7자리)은 식별키/신규INSERT 금지 → 미연결 보류(환자 차단 아님). denormalized name/phone'
  ' 은 raw 또는 NULL(마스킹 저장 금지). SECURITY DEFINER anon RLS 우회. 스키마 무변경. 롤백=20260617 정의.';

COMMIT;
