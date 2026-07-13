-- DRY-RUN (No-Persistence Protocol): T-20260713-foot-PHONE-E164-CHK-UNENFORCED — Step1
-- ============================================================================
-- 목적: 새 CHECK 식(DROP+re-ADD NOT VALID)을 prod(rxlomoozakkjesdqjtvd)에 무영속 적용→
--       accept/reject 실INSERT 검증→sentinel RAISE 로 강제 롤백(무영속).
-- 프로토콜 준수(sentinel-bypass 차단):
--   ① txn-control strip: 실행 body 에 BEGIN/COMMIT 없음(up.sql 의 COMMIT 미포함).
--   ② plpgsql exception-handler 실행: 全 작업을 단일 DO 트랜잭션에서 수행, 末尾 SENTINEL RAISE 로
--      강제 abort → ALTER TABLE(DDL)·seed·test INSERT 全 효과 롤백(무영속).
--   ③ post-probe: 아래 §POST 쿼리로 prod 제약식이 여전히 舊 `82?` 음성가드임을 재확인(비영속 실증).
-- 판정: DO 블록이 'DRYRUN_SENTINEL_OK'(P0001) 로 끝나면 = 모든 accept/reject PASS + 무영속 롤백.
--        'ACCEPT-FAIL …'/'REJECT-FAIL …'/'GUARD-FAIL …' = 기능 결함. 그 외 = DDL 오류.
-- 실행: scripts/T-20260713-foot-PHONE-E164-CHK-UNENFORCED_dryrun.mjs (Supabase Mgmt API)
-- ============================================================================

-- §DO — 무영속 적용 + accept/reject 검증 (sentinel RAISE 로 롤백)
DO $dry$
DECLARE
  v_slug     TEXT := 'zzz-dryrun-chk-t20260713';
  v_clinic   UUID;
  v_ph       TEXT;
  v_rejected BOOLEAN;
  v_def_c    TEXT;
  v_def_r    TEXT;
  v_valid_c  BOOLEAN;
  v_cust_bad_before BIGINT;
  v_cust_bad_after  BIGINT;
BEGIN
  -- (0) 사전: 기존 오염행 수 스냅샷 (NOT VALID → 무변경 기대)
  SELECT count(*) INTO v_cust_bad_before FROM public.customers
    WHERE phone IS NOT NULL AND phone !~ '^\+82(1[016789]\d{7,8})$'
      AND phone NOT LIKE 'DUMMY-%' AND phone <> '+821000000000';

  -- (1) 새 CHECK 식 무영속 적용 (up.sql 의 txn-control strip 판; DO 트랜잭션 내부)
  ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_phone_e164_chk;
  ALTER TABLE public.customers ADD CONSTRAINT customers_phone_e164_chk
    CHECK (
      phone IS NULL
      OR phone ~ '^\+82(1[016789]\d{7,8})$'
      OR phone LIKE 'DUMMY-%'
      OR phone = '+821000000000'
      OR phone ~ '^\+(?!82)[1-9]\d{6,14}$'
    ) NOT VALID;
  ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_customer_phone_e164_chk;
  ALTER TABLE public.reservations ADD CONSTRAINT reservations_customer_phone_e164_chk
    CHECK (
      customer_phone IS NULL
      OR customer_phone ~ '^\+82(1[016789]\d{7,8})$'
      OR customer_phone LIKE 'DUMMY-%'
      OR customer_phone = '+821000000000'
      OR customer_phone ~ '^\+(?!82)[1-9]\d{6,14}$'
    ) NOT VALID;

  -- (2) 식/플래그 착지 검증: 새 식 반영 · NOT VALID · 舊 `82?` 가드 소거
  SELECT pg_get_constraintdef(oid), convalidated INTO v_def_c, v_valid_c
    FROM pg_constraint WHERE conname='customers_phone_e164_chk';
  SELECT pg_get_constraintdef(oid) INTO v_def_r
    FROM pg_constraint WHERE conname='reservations_customer_phone_e164_chk';
  IF v_def_c LIKE '%82?0?1%' OR v_def_r LIKE '%82?0?1%' THEN
    RAISE EXCEPTION 'GUARD-FAIL: 舊 82? 음성가드가 새 식에 잔존: c=%', v_def_c; END IF;
  IF v_def_c NOT LIKE '%(?!82)%' OR v_def_r NOT LIKE '%(?!82)%' THEN
    RAISE EXCEPTION 'GUARD-FAIL: 국제 E.164 분기(?!82) 누락: c=%', v_def_c; END IF;
  IF v_valid_c IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'GUARD-FAIL: NOT VALID 아님(convalidated=%)', v_valid_c; END IF;
  RAISE NOTICE 'GUARD-OK: 새 식 반영 + NOT VALID + 舊가드 소거';

  -- (3) NOT VALID → 기존 오염행 무변경(블록 안 함) 확인
  SELECT count(*) INTO v_cust_bad_after FROM public.customers
    WHERE phone IS NOT NULL AND phone !~ '^\+82(1[016789]\d{7,8})$'
      AND phone NOT LIKE 'DUMMY-%' AND phone <> '+821000000000';
  IF v_cust_bad_after IS DISTINCT FROM v_cust_bad_before THEN
    RAISE EXCEPTION 'GUARD-FAIL: NOT VALID 인데 오염행 수 변동 %→%', v_cust_bad_before, v_cust_bad_after; END IF;
  RAISE NOTICE 'GUARD-OK: 기존 오염행 무변경(cust_bad=%)', v_cust_bad_after;

  -- (4) 합성 클리닉 seed (롤백 대상 — 실 clinics 무영향)
  INSERT INTO public.clinics (name, slug) VALUES ('DRYRUN-CHK', v_slug)
    ON CONFLICT (slug) DO NOTHING;
  SELECT id INTO v_clinic FROM public.clinics WHERE slug=v_slug;

  -- (5) ACCEPT: 허용 phone 은 신규 쓰기 통과해야 함
  --   customers 필수: clinic_id, name, phone, chart_number
  BEGIN
    INSERT INTO public.customers (clinic_id, name, phone, chart_number) VALUES
      (v_clinic, 'DR-KR',    '+821012345678', 'DRYRUN-CHK-A1'),   -- KR E.164
      (v_clinic, 'DR-DUMMY', 'DUMMY-dryrun1', 'DRYRUN-CHK-A2'),   -- DUMMY placeholder
      (v_clinic, 'DR-PLACE', '+821000000000', 'DRYRUN-CHK-A3'),   -- 고정 placeholder
      (v_clinic, 'DR-US',    '+13105551234',  'DRYRUN-CHK-A4'),   -- 국제(US) E.164
      (v_clinic, 'DR-UK',    '+442071838750', 'DRYRUN-CHK-A5');    -- 국제(UK) E.164
    -- (NULL 은 customers.phone 컬럼 NOT NULL 이라 INSERT 불가 → CHECK 의 NULL 분기는 reservations 로 검증)
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'ACCEPT-FAIL customers: 정상 phone 이 거부됨: %', SQLERRM;
  END;
  RAISE NOTICE 'ACCEPT-OK customers: KR/DUMMY/placeholder/US/UK 통과';

  BEGIN
    INSERT INTO public.reservations (clinic_id, reservation_date, reservation_time, customer_phone) VALUES
      (v_clinic, DATE '2026-07-21', TIME '10:00', '+821012345678'),
      (v_clinic, DATE '2026-07-21', TIME '10:10', '+13105551234'),
      (v_clinic, DATE '2026-07-21', TIME '10:20', NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'ACCEPT-FAIL reservations: 정상 customer_phone 이 거부됨: %', SQLERRM;
  END;
  RAISE NOTICE 'ACCEPT-OK reservations: KR/US/NULL 통과';

  -- (6) REJECT: 로컬표기·하이픈·비-E.164 는 신규 쓰기 거부돼야 함 (버그 재현 방지)
  --   각 케이스를 sub-block 으로 감싸 check_violation 만 잡고 flag 로 판정.
  --   customers
  FOREACH v_ph IN ARRAY ARRAY['01012345678','010-1234-5678','+82-10-1234-5678','010 1234 5678','821012345678','+8210'] LOOP
    v_rejected := false;
    BEGIN
      INSERT INTO public.customers (clinic_id, name, phone, chart_number)
        VALUES (v_clinic, 'DR-R', v_ph, 'DRYRUN-CHK-R-' || md5(v_ph));
    EXCEPTION WHEN check_violation THEN v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'REJECT-FAIL customers: 나쁜 값이 ACCEPT 됨 → 버그 재현: phone=%', v_ph; END IF;
    RAISE NOTICE 'REJECT-OK customers: phone=% 거부', v_ph;
  END LOOP;

  --   reservations
  FOREACH v_ph IN ARRAY ARRAY['01012345678','010-1234-5678','+82-10-1234-5678'] LOOP
    v_rejected := false;
    BEGIN
      INSERT INTO public.reservations (clinic_id, reservation_date, reservation_time, customer_phone)
        VALUES (v_clinic, DATE '2026-07-22', TIME '09:00', v_ph);
    EXCEPTION WHEN check_violation THEN v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'REJECT-FAIL reservations: 나쁜 값이 ACCEPT 됨: customer_phone=%', v_ph; END IF;
    RAISE NOTICE 'REJECT-OK reservations: customer_phone=% 거부', v_ph;
  END LOOP;

  -- (7) 全 PASS → sentinel RAISE 로 강제 롤백 (무영속)
  RAISE EXCEPTION 'DRYRUN_SENTINEL_OK all-accept-reject-pass' USING ERRCODE = 'P0001';
END
$dry$;

-- §POST — post-probe: DO 롤백 후 prod 제약식이 여전히 舊 `82?` 음성가드 = 무영속 실증.
--   (dry-run 이 prod 에 아무것도 남기지 않았음을 별도 오토커밋 쿼리로 재확인)
SELECT
  (pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='customers_phone_e164_chk'))
     LIKE '%82?0?1%') AS old_guard_still_present_expected_true,
  (pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='customers_phone_e164_chk'))
     LIKE '%(?!82)%') AS new_intl_branch_present_expected_false;
