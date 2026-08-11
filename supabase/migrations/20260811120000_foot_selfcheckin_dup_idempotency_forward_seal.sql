-- T-20260811-foot-SELFCHECKIN-DUP-IDEMPOTENCY-BACKFILL — Leg A forward-seal (멱등 가드 하드닝)
-- ════════════════════════════════════════════════════════════════════════════
-- DA SSOT: agents/docs/da_replies/da_decision_foot_selfcheckin_dup_idempotency_backfill_20260811.md
--   (DA-20260811-foot-SELFCHECKIN-DUP-IDEMPOTENCY-BACKFILL, verdict=조건부 GO(2-leg))
-- 표준: cross_crm_data_contract §2-10 write-time dedup 룩업 canonical (foot leg).
--
-- ─── 배경(RC — dev-foot census 확정) ────────────────────────────────────────
--   강민구 #F-5465: check_ins 2행 = CI-A(reservation_id 결속·01:55:20 선행) +
--   CI-B(reservation_id=NULL orphan·01:56:07 +47s). customers 1·reservations 1(중복 아님).
--   = rapid 경로전환 재접수(예약 self check-in → 47s 뒤 워크인 self check-in 재실행).
--   ★근본원인 = KST/UTC 날짜프레임 defeat: 키오스크 SelfCheckIn.tsx todayDate =
--     new Date().toISOString().slice(0,10) = UTC 날짜. 00:00~09:00 KST 창(사건 01:55 KST)에서는
--     UTC 가 전일(2026-08-10) → 두 가드(fn_selfcheckin_dup_guard·self_checkin_with_reservation_link §2.5)가
--     `(created_at AT TIME ZONE 'Asia/Seoul')::date = p_today(UTC전일)` 로 비교 → CI-A 의 KST일(08-11)과
--     불일치 → '중복 아님' 오판정 → CI-B 생성. (근접 47s = 증상, 술어 아님)
--   ★seal = 날짜 판정을 client p_today 가 아니라 서버 now-KST `(now() AT TIME ZONE 'Asia/Seoul')::date`
--     로 고정(§2-10 룩업 canonical) → client 날짜프레임 버그 면역. (동반 kiosk todayDate KST 정정 = belt)
--
-- ─── census(dev-foot READ-ONLY, DA 지목 CONFIRM) ─────────────────────────────
--   (a) write-site = 키오스크 foot-checkin/SelfCheckIn.tsx → 본 RPC(권위경로, §2.5 멱등가드
--       旣존재) + 폴백 direct anon check_ins INSERT(RPC 오류 시 발화·멱등룩업 부재 = CI-B 실제
--       생성경로). ★폴백 봉합 = 동반 FE fix(foot-checkin). 본 마이그레이션 = 권위경로 canonical 가드.
--   (b) SECDEF-anon: 본 RPC = SECURITY DEFINER + search_path=public,pg_temp + GRANT anon,authenticated
--       → CREATE OR REPLACE 는 SECDEF/search_path/owner/GRANT byte-preserve (H-A3, §15-5-10).
--   (c) status lifecycle terminal = 'cancelled','done' (Dashboard active = NOT IN('done','cancelled')).
--   (d) clinic-tenant = clinic_id (uuid).
--   (e) CI-B FK dependents(status_transitions/room_logs/timer/pkg_session 등) = Leg B merge-before-archive.
--
-- ─── 수정(§2.5 멱등룩업 = §2-10 canonical 술어로 하드닝, body-only) ──────────
--   변경점 = §2.5 활성 check_in 룩업 술어: status <> 'cancelled'  →  status NOT IN ('cancelled','done').
--   근거(H-A5): terminal 'done'(종결/시술완료) 는 active 아님 → REUSE 대상 제외해야 정당한
--     당일 2차 실방문(체크아웃/종결 후 재방문)을 오차단하지 않음(over-dedup=availability 회귀 방지).
--   ★그 외 함수 본문은 20260719120000(prod 정본) 과 byte-identical — 델타 1줄(§2.5 술어).
--   ★REUSE 는 결속 CI(CI-A) 를 customer_id 또는 reservation_id 로 매칭(reservation_id=NULL orphan-only
--     아님, H-A1/H-A2) → 재탭이 CI-A 재사용 → link-less orphan 애초 미생성. (旣 구현 보존)
--   ★partial UNIQUE index 미도입(§2-10 비권고·정당 2차 실방문 23505 false-block, H-A4).
--   ★스키마/컬럼/enum/시그니처 무변경 = ADDITIVE guard(스키마-shape DDL 0).
--
-- ─── 게이트 ──────────────────────────────────────────────────────────────────
--   'ADDITIVE/DDL 0' ≠ GO-token 면제(AC-1). CREATE OR REPLACE FUNCTION = catalog-mutating →
--   supervisor C10 pg_proc PREFLIGHT + function-diff(SECDEF/search_path/owner/GRANT assert, C23) +
--   물리 GO-token 선행 REQUIRED. GO-token 前 prod apply 금지(apply_before_go).
--   §3.1 CEO 파괴게이트 = 면제(파괴0·RLS 무접촉·exposure-neutral) — 단 apply-gate 면제 아님.
--
-- 롤백: 20260811120000_foot_selfcheckin_dup_idempotency_forward_seal.rollback.sql (술어-前 정본 복원)
-- author: dev-foot / 2026-08-11 · ticket: T-20260811-foot-SELFCHECKIN-DUP-IDEMPOTENCY-BACKFILL
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
      INSERT INTO customers (clinic_id, name, phone, visit_type, sms_opt_in, birth_date, address, privacy_consent, created_by)  -- T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON: INSERT-only 스탬프
      VALUES (
        p_clinic_id, v_name, COALESCE(v_phone, v_phone_e164),
        CASE WHEN v_visit_type = 'returning' THEN 'returning' ELSE 'new' END,
        v_sms_opt_in, v_birth_date, v_address, COALESCE(v_privacy_consent, false), 'self_checkin'
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
  --   ★ T-20260811 forward-seal(§2-10 canonical 술어) — 2축 하드닝:
  --   [축1·RC seal] KST 영업일 판정을 서버권위로 고정: 종전 `= v_today`(=COALESCE(p_today,...) →
  --     키오스크가 넘긴 client todayDate) 대신 `= (now() AT TIME ZONE 'Asia/Seoul')::date` 사용.
  --     RC: 키오스크 todayDate = new Date().toISOString()(UTC) → 00:00~09:00 KST 창에서 전일(UTC)
  --     날짜 → row 의 KST일과 frame 불일치 → 가드가 CI-A 를 못 잡아 CI-B(orphan) 생성(강민구 01:55/01:56 KST).
  --     서버 now-KST 로 양변 정렬 → client 날짜프레임 버그에 면역(§2-10 룩업 canonical).
  --   [축2·H-A5] active/non-terminal scope: terminal('cancelled' 취소, 'done' 종결/시술완료) REUSE 제외
  --     → 정당한 당일 2차 실방문(체크아웃/종결 후 재방문)을 오차단하지 않음(over-dedup 방지).
  --   REUSE 는 결속 CI(CI-A: reservation_id 또는 customer_id 매칭·선행행 ORDER BY created_at ASC)
  --     → 워크인 재탭이 CI-A 재사용 → link-less orphan(CI-B) 애초 미생성(RC 2축 동시 봉합).
  SELECT id, queue_number INTO v_existing_id, v_existing_queue
    FROM check_ins
   WHERE clinic_id = p_clinic_id
     AND status NOT IN ('cancelled', 'done')
     AND (created_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date
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

-- H-A3: SECDEF-anon GRANT 보존 재선언(byte-identical). owner 는 CREATE OR REPLACE 가 보존.
GRANT EXECUTE ON FUNCTION public.self_checkin_with_reservation_link(uuid, jsonb, date) TO anon, authenticated;

COMMENT ON FUNCTION public.self_checkin_with_reservation_link IS
  'T-20260811-foot-SELFCHECKIN-DUP-IDEMPOTENCY-BACKFILL Leg A forward-seal: §2.5 멱등룩업을 §2-10 canonical'
  ' 술어로 하드닝 — [1] KST 영업일 판정을 서버 now-KST 로 고정(client p_today 날짜프레임 버그 면역=RC seal)'
  ' [2] active/non-terminal(status NOT IN (cancelled,done)). REUSE=결속 CI(CI-A) 매칭 → orphan(CI-B) 미생성.'
  ' SECDEF-anon byte-preserve. 델타=§2.5 (date frame + terminal) 2줄(20260719120000 정본 기반).';

-- ════════════════════════════════════════════════════════════════════════════
-- fn_selfcheckin_dup_guard — 1급 pre-check 가드 동일 하드닝 (키오스크 pre-INSERT 게이트)
--   키오스크(SelfCheckIn.tsx L1853)가 INSERT 前 1급으로 호출. 종전 정본(20260602200000)은
--   `(ci.created_at AT TIME ZONE 'Asia/Seoul')::date = p_today` 로 client todayDate(UTC) 를 신뢰 →
--   RPC §2.5 와 동일 KST/UTC frame defeat 로 CI-B 를 통과시킴(pre-check 무력화).
--   seal: 날짜 판정을 서버 now-KST 로 고정(p_today 무시) + terminal('cancelled','done') 제외(H-A5).
--   ★시그니처/SECDEF/search_path/owner/GRANT byte-preserve(H-A3). 반환 계약(jsonb duplicate/error_code) 불변.
-- ════════════════════════════════════════════════════════════════════════════
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
      -- H-A5: terminal(취소·종결/시술완료) 제외 → 정당한 당일 2차 실방문 오차단 방지.
      AND ci.status NOT IN ('cancelled', 'done')
      -- ★RC seal: KST 영업일 = 서버 now-KST 고정(client p_today 무시). UTC/KST frame defeat 면역.
      AND (ci.created_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date
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

COMMENT ON FUNCTION public.fn_selfcheckin_dup_guard IS
  'T-20260811-foot-SELFCHECKIN-DUP-IDEMPOTENCY-BACKFILL Leg A: 셀프체크인 당일 중복 pre-check 가드.'
  ' KST 영업일=서버 now-KST 고정(client p_today 날짜프레임 버그 면역) + terminal(cancelled,done) 제외(H-A5).'
  ' 반환 계약(duplicate/error_code) 불변·조회전용. 델타=날짜프레임+terminal(20260602200000 정본 기반).';

COMMIT;
