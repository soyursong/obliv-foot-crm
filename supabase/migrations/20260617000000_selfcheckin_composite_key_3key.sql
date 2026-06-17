-- T-20260617-foot-CHECKIN-CHART-LINK-3KEY (AC-1): 셀프체크인 RPC 고객 해소를 복합키(성함 AND 연락처)로 강제
--
-- 배경: self_checkin_with_reservation_link 는 FE 가 customer_id 를 미전달(NULL)하면
--   서버에서 phone 단독으로 기존 고객을 재해소했다(원본 20260602210000 §1, lines 92-103).
--   연락처가 중복이면 동명이인/타 고객(예: '문자테스트')을 임의 1건 픽 → 체크인 오배정.
--   (6/17 김사비→문자테스트 재발 / 6/3 DASH-SLOT-CHART-MISMAP 동일 축).
--   FE(SelfCheckIn.tsx)는 본 티켓에서 복합키로 선해소하나, RPC NULL-path 가 살아있으면
--   FE 가 의도적으로 NULL(성함+연락처 동시중복=ambiguous)을 보낼 때 서버가 phone 단독으로
--   되살려 오배정을 재현한다 → 서버 권위 경로도 복합키로 막는다.
--
-- 변경: §1 customer 해소를 clinic + 성함(name) AND 연락처(phone) 복합으로 교체.
--   · 정확히 1건 → 자동 연결(+ sms_opt_in 갱신)
--   · 0건       → 신규 INSERT (genuine new patient — 기존 동작 보존)
--   · 2건+      → 성함+연락처 동시중복 = 임의 자동연결/신규생성 모두 보류.
--                 v_customer_id NULL 유지 → check_in 은 denormalized 성함/연락처만 기록(미연결).
--                 현장(대시보드)에서 복합키로 재해소.
--   연락처는 저장 포맷(E.164/숫자/하이픈)이 섞여 있어 canonical national digits(앞 0→82)로 비교.
--   ※ 스키마 무변경(기존 컬럼 name/phone). 함수 본문만 교체 → data-architect 게이트 불요.
--   ※ §2~§6(예약매칭·멱등·발번·INSERT·전이·로그)는 원본과 동일 — 회귀 없음.
-- author: dev-foot / 2026-06-17

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

  -- AC-4: 동시성 직렬화 — next_queue_number 와 동일 advisory key (트랜잭션 종료까지 보유)
  PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id::text || v_today::text));

  -- ── 1) customer 해소: 복합키(성함 AND 연락처) — T-20260617-foot-CHECKIN-CHART-LINK-3KEY AC-1 ──
  --   FE 가 customer_id 미전달(NULL) 시에만 서버 fallback. phone 단독 매칭(오배정) 제거.
  IF v_customer_id IS NULL AND v_phone_canon IS NOT NULL THEN
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
      -- 성함+연락처 정확히 1건 → 자동 연결
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
      -- 신규 환자 → INSERT (privacy_consent NOT NULL default false → COALESCE 보정)
      INSERT INTO customers (clinic_id, name, phone, visit_type, sms_opt_in, birth_date, address, privacy_consent)
      VALUES (
        p_clinic_id, v_name, COALESCE(v_phone, v_phone_e164),
        CASE WHEN v_visit_type = 'returning' THEN 'returning' ELSE 'new' END,
        v_sms_opt_in, v_birth_date, v_address, COALESCE(v_privacy_consent, false)
      )
      RETURNING id INTO v_customer_id;
    ELSE
      -- v_match_count >= 2: 성함+연락처 동시중복 → 임의 자동연결/신규생성 보류.
      -- v_customer_id NULL 유지 → check_in 은 미연결(denormalized 성함/연락처 보존), 현장 재해소.
      NULL;
    END IF;
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

  -- ── 4) check_ins INSERT (reservation_id 연결) ──
  BEGIN
    INSERT INTO check_ins (
      clinic_id, customer_id, customer_name, customer_phone,
      visit_type, status, queue_number, notes, reservation_id
    ) VALUES (
      p_clinic_id, v_customer_id, v_name, v_phone,
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
    'reservation_linked', COALESCE(v_resv_linked, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.self_checkin_with_reservation_link(UUID, JSONB, DATE)
  TO anon, authenticated;

COMMENT ON FUNCTION public.self_checkin_with_reservation_link IS
  'T-20260617-foot-CHECKIN-CHART-LINK-3KEY: 셀프체크인↔예약 원자적 연결 + 고객 해소 복합키(성함 AND 연락처) 강제.'
  ' customer 해소(복합키 1건만 자동연결/0건 생성/2건+ 미연결) → 예약매칭 → queue 발번'
  ' → check_ins INSERT → reservations.status=checked_in 전이 → status_transitions 1건.'
  ' SECURITY DEFINER anon RLS 우회. advisory lock 직렬화. 워크인은 reservations 무변경.';

COMMIT;
