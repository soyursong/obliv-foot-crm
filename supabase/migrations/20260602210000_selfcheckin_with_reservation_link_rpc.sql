-- T-20260602-foot-SELFCHECKIN-RESV-LINK (P0, 대표 직접 승인 MSG-20260602-160425)
-- 셀프체크인 ↔ 사전예약 원자적 연결 RPC 신설
--
-- ─── 배경 ────────────────────────────────────────────────────────────────────
-- 셀프체크인 키오스크(foot-checkin.pages.dev)는 customer upsert → next_queue_number RPC →
-- check_ins INSERT → reservations.status UPDATE 를 *분산*(별도 라운드트립)으로 수행.
-- 문제 3가지:
--   (1) 비원자성 — queue 산출/INSERT/예약전이 사이 race 가능. advisory lock 이 INSERT 까지만 커버.
--   (2) reservations.status UPDATE 가 anon RLS 로 silent-fail → 예약이 'confirmed' 에 멈춤(AC-1 깨짐).
--       FE 는 catch 로 무시 → 칸반/통계 정합성 붕괴.
--   (3) status_transitions lifecycle row 미기록 (AC-3 누락).
--
-- ─── 해소 ────────────────────────────────────────────────────────────────────
-- 단일 트랜잭션 RPC self_checkin_with_reservation_link 로 통합:
--   customer upsert(옵션) → 예약 매칭 → queue 발번 → check_ins INSERT →
--   reservations.status='checked_in' 전이 → status_transitions 1건 — 모두 atomic.
--   pg_advisory_xact_lock(next_queue_number 와 동일 키)로 동시성 직렬화(AC-4).
--
-- ─── AC-5 방식: SECURITY DEFINER 우회 (안 1, 채택) ───────────────────────────
--   anon RLS(anon_insert_checkin_self 는 status='registered' 만 허용)를 정책 확장하지 않고,
--   SECURITY DEFINER 함수 본문이 definer(owner) 권한으로 INSERT/UPDATE 수행 → RLS 우회.
--   기존 dup_guard / today_reservations RPC 와 동일 house 패턴. anon 정책·CHECK constraint 무변경.
--   (안 2: anon UPDATE 정책 확장 — reservations 에 anon UPDATE 노출은 공격면 확대 + CHECK 동시갱신
--    부담 → 미채택.)
--
-- ─── 멱등/회귀 ──────────────────────────────────────────────────────────────
--   · 매칭 예약에 이미 활성 check_in 존재 시 → 신규 발번 없이 기존 반환(already_checked_in).
--   · 워크인(reservation_id 매칭 없음): check_ins 만 INSERT, reservations 무변경(AC-2 회귀 0).
--   · UNIQUE 위반(23505: unique_reservation_checkin / idx_checkins_walkin_daily) → duplicate 반환,
--     FE 가 한글 안내 + 재시도 비활성으로 매핑(DUP-GUARD 티켓 AC 보존).
--   · reservations.status CHECK 에 'checked_in' 이미 포함(initial_schema L118) → CHECK 무영향.
--   · 신규 상태값 도입 없음 — batch_checkin / Dashboard 수동전환과 동일 종착상태로 수렴.
--
-- ─── 보안 ────────────────────────────────────────────────────────────────────
--   SECURITY DEFINER + search_path 고정. clinic_id 스코프 강제 → cross-clinic 누출 없음.
--   GRANT EXECUTE anon(키오스크 비로그인) + authenticated.
--
-- 롤백: 20260602210000_selfcheckin_with_reservation_link_rpc.rollback.sql (DROP FUNCTION)
-- ticket: T-20260602-foot-SELFCHECKIN-RESV-LINK
-- author: dev-foot / 2026-06-02

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

  -- AC-4: 동시성 직렬화 — next_queue_number 와 동일 advisory key (트랜잭션 종료까지 보유)
  PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id::text || v_today::text));

  -- ── 1) customer upsert (FE 가 customer_id 미전달 시 fallback) ──────────────
  IF v_customer_id IS NULL THEN
    SELECT id INTO v_customer_id
      FROM customers
     WHERE clinic_id = p_clinic_id
       AND (
         (v_phone IS NOT NULL AND phone = v_phone)
         OR (v_phone_digits IS NOT NULL AND length(v_phone_digits) >= 10
             AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = v_phone_digits)
       )
     ORDER BY created_at ASC
     LIMIT 1;

    IF v_customer_id IS NULL THEN
      -- privacy_consent 는 NOT NULL(default false) → 명시적 NULL 금지, COALESCE 로 보정.
      INSERT INTO customers (clinic_id, name, phone, visit_type, sms_opt_in, birth_date, address, privacy_consent)
      VALUES (
        p_clinic_id, v_name, COALESCE(v_phone, v_phone_e164),
        CASE WHEN v_visit_type = 'returning' THEN 'returning' ELSE 'new' END,
        v_sms_opt_in, v_birth_date, v_address, COALESCE(v_privacy_consent, false)
      )
      RETURNING id INTO v_customer_id;
    ELSE
      UPDATE customers SET sms_opt_in = v_sms_opt_in WHERE id = v_customer_id;
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
  -- 매칭 예약 기준(더블탭/재시도) + customer_id 기준(동일고객 당일 중복) 둘 다 커버.
  -- FE dup_guard 가 1차(에러 표시), 본 검사는 서버 권위 멱등(레이스/우회 방어).
  -- idx_checkins_walkin_daily(게이트) 미배포 환경에서도 동일고객 당일 중복 INSERT 방지.
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
    -- unique_reservation_checkin / idx_checkins_walkin_daily 최종 방어 → graceful 한글 매핑
    RETURN jsonb_build_object('success', false, 'duplicate', true,
                              'error_code', 'DUPLICATE_CHECKIN_TODAY');
  END;

  -- ── 5) 예약 매칭 시 status 전이 (SECURITY DEFINER → anon RLS 우회, AC-1/AC-5) ──
  -- 참고: AFTER INSERT 트리거 trg_checkin_sync_reservation 가 이미 동일 전이를 수행(SECURITY DEFINER).
  -- 본 UPDATE 는 belt-and-suspenders(트리거가 제거/비활성이어도 RPC 단독으로 AC-1 보장). 멱등(0행 무해).
  IF v_reservation_id IS NOT NULL THEN
    UPDATE reservations
       SET status = 'checked_in', updated_at = now()
     WHERE id = v_reservation_id AND status = 'confirmed';
    v_resv_linked := true;  -- check_in 이 예약에 연결됨(전이 주체가 트리거든 본 UPDATE든 결과 동일)
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
  'T-20260602-foot-SELFCHECKIN-RESV-LINK: 셀프체크인↔사전예약 원자적 연결.'
  ' customer upsert(옵션) → 예약매칭(FE-resolved 우선/customer_id+today+clinic fallback) → queue 발번'
  ' → check_ins INSERT(reservation_id) → reservations.status=checked_in 전이 → status_transitions 1건.'
  ' SECURITY DEFINER 로 anon RLS 우회(AC-5 안1). advisory lock 직렬화(AC-4). 워크인은 reservations 무변경(AC-2).';

COMMIT;
