-- T-20260602-foot-TZ-AUDIT-FIX (P2) — AC-7 후속 timezone 교정 (RPC 일일경계 KST 통일)
--
-- ─── 배경 ────────────────────────────────────────────────────────────────────
-- check_ins.checked_in_at 은 timestamptz(UTC 저장). 여러 RPC가 일일경계(체크인카운트/대기번호
-- 발번)를 `checked_in_at::date` 로 비교 → 세션 tz(서버 UTC)로 캐스팅됨. 반면 비교 우변(v_today
-- 등)은 (now() AT TIME ZONE 'Asia/Seoul')::date = KST 날짜.
--   → 좌변 UTC-date vs 우변 KST-date 불일치.
--   → KST 오전(00:00~09:00 = 전일 15:00~24:00 UTC) 체크인이 "당일"에서 누락/오집계.
--     대기번호 리셋·중복·체크인 카운트 오류 유발(FE는 T-20260531-DASHBOARD-KST-FILTER 로 기교정,
--     본 티켓은 RPC/DB 잔존분).
--
-- ─── 해소 ────────────────────────────────────────────────────────────────────
-- 좌변을 KST 기준으로 통일: `checked_in_at::date` → `kst_date(checked_in_at)`.
--   kst_date(ts) 는 IMMUTABLE 헬퍼(20260421000001_p2_fixes.sql):
--     SELECT (ts AT TIME ZONE 'Asia/Seoul')::DATE;
--   인덱스/쿼리 양쪽에서 동일 표현식을 써야 plan 매칭(20260602250010 index 교정과 짝).
--
-- ─── 대상 (활성 정의만 CREATE OR REPLACE) ──────────────────────────────────────
--   1) next_queue_number          (20260420000011 활성판) — 대기번호 발번
--   2) batch_checkin              (20260517000011 활성판) — 일괄 체크인 발번
--   3) self_checkin_with_reservation_link (20260602210000 활성판) — 셀프체크인 발번
--   4) assign_consultant_atomic   (20260421000001 활성판) — 상담사별 당일 체크인 카운트
--
-- ─── 범위 외 (감사상 false-positive / superseded) ─────────────────────────────
--   · 20260419000000_initial_schema.sql:365 next_queue_number(sql판) → 20260420000011 로 대체됨(비활성).
--   · 20260420000013_race_condition_fixes.sql:82 batch_checkin(구판) → 20260517000011 로 대체됨(비활성).
--   · 20260517000011_..._auto_stage.down.sql:30 → 롤백 파일(과거 상태 복원용, 의도적 보존).
--   · 20260526140000_dummy_progress_test.sql 의 ::date 리터럴(~15건) → 테스트 시드, 제외.
--   · self_checkin v_birth_date := ...::date 등 입력 문자열 파싱 캐스트 → tz 무관, 제외.
--   (초판/구판 파일은 immutable 히스토리로 보존 — 본 forward 마이그레이션이 최신 정의로 수렴.)
--
-- 멱등: 전부 CREATE OR REPLACE. 회귀 0(KST 날짜 캐스팅만 변경, 로직 동일).
-- 롤백: 20260602250000_tz_checkin_kst_unify.rollback.sql
-- 적용: node scripts/apply_20260602250000_tz_checkin_kst_unify.mjs
-- ticket: T-20260602-foot-TZ-AUDIT-FIX
-- author: dev-foot / 2026-06-02

BEGIN;

-- 방어: kst_date 헬퍼 보장(20260421000001 에서 생성됨, 멱등 재확인).
CREATE OR REPLACE FUNCTION kst_date(ts TIMESTAMPTZ)
RETURNS DATE AS $$
  SELECT (ts AT TIME ZONE 'Asia/Seoul')::DATE;
$$ LANGUAGE sql IMMUTABLE;

-- ── 1) next_queue_number — 대기번호 발번 (advisory lock 직렬화) ──
CREATE OR REPLACE FUNCTION next_queue_number(p_clinic_id UUID, p_date DATE DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_date DATE;
  v_next INTEGER;
BEGIN
  v_date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Seoul')::date);
  -- Advisory lock keyed on clinic_id hash + date to serialize queue number generation
  PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id::text || v_date::text));
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_next
  FROM check_ins
  WHERE clinic_id = p_clinic_id
    AND kst_date(checked_in_at) = v_date;   -- TZ-FIX: checked_in_at::date(UTC) → KST
  RETURN v_next;
END;
$$;

-- ── 2) batch_checkin — 일괄 체크인(visit_type 자동 스테이지) ──
CREATE OR REPLACE FUNCTION batch_checkin(
  p_clinic_id UUID,
  p_reservations JSONB
) RETURNS JSONB AS $$
DECLARE
  v_res JSONB;
  v_qn INT;
  v_success INT := 0;
  v_skipped INT := 0;
  v_date TEXT;
  v_visit_type TEXT;
  v_auto_status TEXT;
BEGIN
  FOR v_res IN SELECT * FROM jsonb_array_elements(p_reservations)
  LOOP
    v_date := v_res->>'reservation_date';
    v_visit_type := COALESCE(v_res->>'visit_type', 'new');

    -- AC-1/AC-2: 초진·체험 → 상담대기, 재진 → 치료대기 자동 세팅
    IF v_visit_type = 'returning' THEN
      v_auto_status := 'treatment_waiting';
    ELSE
      v_auto_status := 'consult_waiting';
    END IF;

    -- Skip if already checked in
    IF EXISTS (SELECT 1 FROM check_ins WHERE reservation_id = (v_res->>'id')::UUID) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Atomic queue number
    PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id::TEXT || v_date));
    SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_qn
    FROM check_ins
    WHERE clinic_id = p_clinic_id
      AND kst_date(checked_in_at) = v_date::DATE;   -- TZ-FIX: checked_in_at::DATE(UTC) → KST

    INSERT INTO check_ins (
      clinic_id, customer_id, reservation_id, customer_name, customer_phone,
      visit_type, status, queue_number
    ) VALUES (
      p_clinic_id,
      (v_res->>'customer_id')::UUID,
      (v_res->>'id')::UUID,
      v_res->>'customer_name',
      v_res->>'customer_phone',
      v_visit_type,
      v_auto_status,
      v_qn
    );

    UPDATE reservations SET status = 'checked_in' WHERE id = (v_res->>'id')::UUID;
    v_success := v_success + 1;
  END LOOP;

  RETURN jsonb_build_object('success', v_success, 'skipped', v_skipped);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3) assign_consultant_atomic — 상담사별 당일 체크인 카운트로 부하분산 ──
CREATE OR REPLACE FUNCTION assign_consultant_atomic(
  p_clinic_id UUID,
  p_date TEXT,
  p_max_concurrent INT DEFAULT 3
) RETURNS UUID AS $$
DECLARE
  v_best_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('assign_consultant_' || p_clinic_id::TEXT || p_date));

  SELECT ra.staff_id INTO v_best_id
  FROM room_assignments ra
  WHERE ra.clinic_id = p_clinic_id
    AND ra.date = p_date::DATE
    AND ra.room_type = 'consultation'
    AND ra.staff_id IS NOT NULL
  ORDER BY (
    SELECT COUNT(*) FROM check_ins ci
    WHERE ci.clinic_id = p_clinic_id
      AND ci.consultant_id = ra.staff_id
      AND ci.status IN ('consult_waiting', 'consultation')
      AND kst_date(ci.checked_in_at) = p_date::DATE   -- TZ-FIX: checked_in_at::DATE(UTC) → KST
  ) ASC
  LIMIT 1;

  RETURN v_best_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 4) self_checkin_with_reservation_link — 셀프체크인 원자적 연결(발번 KST 교정) ──
--   * line 159(원본) queue 발번만 KST 로 교정. 그 외 본문은 20260602210000 와 동일(byte-faithful).
--   * 멱등/중복 방어(created_at AT TIME ZONE 'Asia/Seoul')는 이미 KST — 본 교정으로 발번까지 KST 정합.
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
     AND kst_date(checked_in_at) = v_today;   -- TZ-FIX: checked_in_at::date(UTC) → KST (2.5 와 동일 KST 기준 정합)

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
  'T-20260602-foot-SELFCHECKIN-RESV-LINK (+TZ-AUDIT-FIX): 셀프체크인↔사전예약 원자적 연결.'
  ' queue 발번 kst_date(checked_in_at) KST 통일. SECURITY DEFINER anon RLS 우회. advisory lock 직렬화.';

-- ── 자체 검증 (적용 즉시 함수 정의에 kst_date 포함 확인) ──
DO $$
DECLARE
  v_missing TEXT := '';
BEGIN
  IF position('kst_date(checked_in_at)' IN pg_get_functiondef('next_queue_number(uuid,date)'::regprocedure)) = 0
     THEN v_missing := v_missing || 'next_queue_number '; END IF;
  IF position('kst_date(checked_in_at)' IN pg_get_functiondef('batch_checkin(uuid,jsonb)'::regprocedure)) = 0
     THEN v_missing := v_missing || 'batch_checkin '; END IF;
  IF position('kst_date(ci.checked_in_at)' IN pg_get_functiondef('assign_consultant_atomic(uuid,text,int)'::regprocedure)) = 0
     THEN v_missing := v_missing || 'assign_consultant_atomic '; END IF;
  IF position('kst_date(checked_in_at)' IN pg_get_functiondef('self_checkin_with_reservation_link(uuid,jsonb,date)'::regprocedure)) = 0
     THEN v_missing := v_missing || 'self_checkin_with_reservation_link '; END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'ASSERT FAILED: kst_date 미반영 함수 → %', v_missing;
  END IF;
  RAISE NOTICE 'T-20260602-foot-TZ-AUDIT-FIX: 4개 RPC kst_date 통일 완료.';
END;
$$;

COMMIT;
