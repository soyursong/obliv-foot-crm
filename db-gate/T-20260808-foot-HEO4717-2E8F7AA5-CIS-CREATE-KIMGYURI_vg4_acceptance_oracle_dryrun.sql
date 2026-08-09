-- VG4 ACCEPTANCE ORACLE — No-Persistence dry-run (DA §5 VG4, dispositive·검토 B 실증)
-- T-20260808-foot-HEO4717-2E8F7AA5-CIS-CREATE-KIMGYURI
--
-- 목적: apply 前 BLOCKING. cis 신규 CREATE 가 축 직교(cis ⊥ payments)임을 empirical 로 증명.
--   (a) v_daily_revenue[2026-07-28] single_revenue delta = 0  (cis 미참조 실증 — delta≠0 → 숨은 트리거/커플링 → ABORT / re-CONSULT #1)
--   (b) payments count 불변                                    (2번째 결제 자동생성 0 — +1 이면 진짜 이중계상 HARD ABORT / re-CONSULT #2)
--   (c) service_charges count 불변 (check_in c33dfc76)         (CTB 명세 자동파생 0)
--   (d) 화장품-판매자 breakdown 김규리(3a0c6774) += 15,000     (1라인·정확히 +15,000)
--
-- ★ No-Persistence 보장: 본 DO 블록은 끝에서 RAISE EXCEPTION 으로 전체를 강제 ROLLBACK 한다.
--   INSERT 는 블록 내부에서만 존재하고 커밋되지 않는다. COMMIT/트랜잭션 제어문 없음(sentinel-bypass 불가).
--   측정치는 RAISE NOTICE 로 예외 발생 前 emit → 로그에서 판독. 사후 post-probe(별도)로 무영속 재확인.
-- ★ 이 파일은 prod 에 아무것도 남기지 않는다. GO-token 前 실행 허용(persist 0 = apply_before_go 아님).

DO $$
DECLARE
  v_clinic      uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  v_checkin     uuid := 'c33dfc76-cda5-48e6-9b34-277281b26626';
  v_service_ctb uuid := 'e17ba3a3-4842-4097-87bc-0778a64d2755';
  v_seller      uuid := '3a0c6774-2bd9-4018-bb38-ef6fab75d04b';
  rev_before    numeric;
  rev_after     numeric;
  pay_before    bigint;
  pay_after     bigint;
  sc_before     bigint;
  sc_after      bigint;
  cos_before    numeric;
  cos_after     numeric;
BEGIN
  -- baselines
  SELECT single_revenue INTO rev_before FROM public.v_daily_revenue WHERE dt = DATE '2026-07-28' AND clinic_id = v_clinic;
  SELECT count(*) INTO pay_before FROM public.payments WHERE check_in_id = v_checkin;
  SELECT count(*) INTO sc_before  FROM public.service_charges WHERE check_in_id = v_checkin;
  SELECT COALESCE(sum(price),0) INTO cos_before
    FROM public.check_in_services
   WHERE seller_staff_id = v_seller AND voided_at IS NULL AND price > 0;

  -- the CREATE under test (rolled back)
  INSERT INTO public.check_in_services
    (id, check_in_id, service_id, service_name, price, original_price,
     is_package_session, package_session_id, seller_staff_id,
     koh_nail_sites, koh_requested, blood_test_requested)
  VALUES
    ('070652f3-3cb0-414a-ad80-98bf4c967e59'::uuid, v_checkin, v_service_ctb,
     'Care Toe Band (CTB)', 15000, 15000, false, NULL, v_seller,
     '{}'::jsonb, false, false);

  -- after-state
  SELECT single_revenue INTO rev_after FROM public.v_daily_revenue WHERE dt = DATE '2026-07-28' AND clinic_id = v_clinic;
  SELECT count(*) INTO pay_after FROM public.payments WHERE check_in_id = v_checkin;
  SELECT count(*) INTO sc_after  FROM public.service_charges WHERE check_in_id = v_checkin;
  SELECT COALESCE(sum(price),0) INTO cos_after
    FROM public.check_in_services
   WHERE seller_staff_id = v_seller AND voided_at IS NULL AND price > 0;

  RAISE NOTICE 'VG4(a) v_daily_revenue[07-28] before=% after=% delta=% (EXPECT 0)', rev_before, rev_after, (rev_after - rev_before);
  RAISE NOTICE 'VG4(b) payments count before=% after=% delta=% (EXPECT 0)', pay_before, pay_after, (pay_after - pay_before);
  RAISE NOTICE 'VG4(c) service_charges count before=% after=% delta=% (EXPECT 0)', sc_before, sc_after, (sc_after - sc_before);
  RAISE NOTICE 'VG4(d) 김규리 cosmetic breakdown before=% after=% delta=% (EXPECT +15000)', cos_before, cos_after, (cos_after - cos_before);

  -- hard oracle assertions
  IF (rev_after - rev_before) <> 0 THEN
    RAISE EXCEPTION 'VG4(a) FAIL: v_daily_revenue delta=% (expected 0) → 축직교 반증 → ABORT/re-CONSULT', (rev_after - rev_before);
  END IF;
  IF (pay_after - pay_before) <> 0 THEN
    RAISE EXCEPTION 'VG4(b) FAIL: payments delta=% (expected 0) → 이중계상 HARD ABORT', (pay_after - pay_before);
  END IF;
  IF (sc_after - sc_before) <> 0 THEN
    RAISE EXCEPTION 'VG4(c) FAIL: service_charges delta=% (expected 0) → 명세 자동파생 ABORT', (sc_after - sc_before);
  END IF;
  IF (cos_after - cos_before) <> 15000 THEN
    RAISE EXCEPTION 'VG4(d) FAIL: cosmetic breakdown delta=% (expected 15000)', (cos_after - cos_before);
  END IF;

  -- force full rollback (No-Persistence sentinel)
  RAISE EXCEPTION 'VG4_DRYRUN_OK_ROLLBACK_SENTINEL: all 4 oracles PASS — nothing persisted';
END $$;
