-- ROLLBACK — T-20260811-foot-SELFCHECKIN-DUP-IDEMPOTENCY-BACKFILL Leg A forward-seal
-- 두 SECDEF-anon 가드를 seal-前 prod 정본으로 복원:
--   · self_checkin_with_reservation_link → 20260719120000 정본(§2.5: status <> 'cancelled' · = v_today)
--   · fn_selfcheckin_dup_guard           → 20260602200000 정본(status NOT IN ('cancelled') · = p_today)
-- SECDEF/search_path/owner/GRANT byte-preserve. author: dev-foot / 2026-08-11
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

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
  v_name_masked  := (position('*' in v_name) > 0);
  v_phone_masked := (position('*' in COALESCE(v_phone,'')) > 0)
                    OR (v_phone_digits IS NOT NULL AND length(v_phone_digits) BETWEEN 1 AND 7);
  v_masking_seen := v_name_masked OR v_phone_masked;

  -- AC-4: 동시성 직렬화 — next_queue_number 와 동일 advisory key (트랜잭션 종료까지 보유)
  PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id::text || v_today::text));

  -- ── 1) customer 해소 ──
  IF v_reservation_id IS NOT NULL THEN
    SELECT customer_id INTO v_customer_id
      FROM reservations
     WHERE id = v_reservation_id
       AND clinic_id = p_clinic_id
     LIMIT 1;

  ELSIF v_customer_id IS NOT NULL THEN
    PERFORM 1 FROM customers WHERE id = v_customer_id AND clinic_id = p_clinic_id;
    IF NOT FOUND THEN
      v_customer_id := NULL;
    END IF;

  ELSIF v_masking_seen THEN
    v_guard_fired := true;

  ELSIF v_phone_canon IS NOT NULL THEN
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
      INSERT INTO customers (clinic_id, name, phone, visit_type, sms_opt_in, birth_date, address, privacy_consent, created_by)
      VALUES (
        p_clinic_id, v_name, COALESCE(v_phone, v_phone_e164),
        CASE WHEN v_visit_type = 'returning' THEN 'returning' ELSE 'new' END,
        v_sms_opt_in, v_birth_date, v_address, COALESCE(v_privacy_consent, false), 'self_checkin'
      )
      RETURNING id INTO v_customer_id;
    ELSE
      NULL;
    END IF;
  END IF;

  -- ── 1.5) WS-A (d): denormalized 성함/연락처 결정 ──
  IF v_customer_id IS NOT NULL THEN
    SELECT name, phone INTO v_denorm_name, v_denorm_phone
      FROM customers WHERE id = v_customer_id;
  ELSIF v_masking_seen THEN
    v_denorm_name  := '미확인';
    v_denorm_phone := NULL;
  ELSE
    v_denorm_name  := v_name;
    v_denorm_phone := v_phone;
  END IF;

  -- ── 2) 예약 매칭 ──
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

  -- ── 2.5) 멱등/중복 방어 (seal-前 정본: status <> 'cancelled' · = v_today) ──
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

  -- ── 3) queue 발번 ──
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue
    FROM check_ins
   WHERE clinic_id = p_clinic_id
     AND checked_in_at::date = v_today;

  -- ── 4) check_ins INSERT ──
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

  -- ── 5) 예약 매칭 시 status 전이 ──
  IF v_reservation_id IS NOT NULL THEN
    UPDATE reservations
       SET status = 'checked_in', updated_at = now()
     WHERE id = v_reservation_id AND status = 'confirmed';
    v_resv_linked := true;
  END IF;

  -- ── 6) status_transitions lifecycle 1건 ──
  INSERT INTO status_transitions (check_in_id, clinic_id, from_status, to_status, changed_by)
  VALUES (v_check_in_id, p_clinic_id, 'registered', v_ci_status, 'self_checkin');

  RETURN jsonb_build_object(
    'success', true,
    'check_in_id', v_check_in_id,
    'queue_number', v_queue,
    'customer_id', v_customer_id,
    'reservation_id', v_reservation_id,
    'reservation_linked', COALESCE(v_resv_linked, false),
    'unlinked_masking_hold', v_guard_fired
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.self_checkin_with_reservation_link(uuid, jsonb, date) TO anon, authenticated;

-- fn_selfcheckin_dup_guard → 20260602200000 정본 복원
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_dup_guard(
  p_clinic_id   UUID,
  p_customer_id UUID,
  p_phone       TEXT,
  p_today       DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone_digits TEXT := NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_exists       BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.check_ins ci
    WHERE ci.clinic_id = p_clinic_id
      AND ci.status NOT IN ('cancelled')
      AND (ci.created_at AT TIME ZONE 'Asia/Seoul')::date = p_today
      AND (
        (p_customer_id IS NOT NULL AND ci.customer_id = p_customer_id)
        OR (p_phone IS NOT NULL AND ci.customer_phone = p_phone)
        OR (
          v_phone_digits IS NOT NULL
          AND length(v_phone_digits) >= 10
          AND regexp_replace(COALESCE(ci.customer_phone, ''), '[^0-9]', '', 'g') = v_phone_digits
        )
      )
  ) INTO v_exists;

  IF v_exists THEN
    RETURN jsonb_build_object('duplicate', true, 'error_code', 'DUPLICATE_CHECKIN_TODAY');
  END IF;

  RETURN jsonb_build_object('duplicate', false, 'error_code', NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_dup_guard(UUID, UUID, TEXT, DATE)
  TO anon, authenticated;

COMMIT;
