-- T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI — VG4 acceptance oracle (No-Persistence dry-run, standalone)
--
-- supervisor DB-GATE 에서 단독 실행 가능한 무영속 dry-run 오라클. DO 블록 내 3-row INSERT 후 4 delta 측정 →
-- RAISE EXCEPTION 으로 전체 강제 ROLLBACK (persist 0). 기대: rev=0 pay=0 sc=0 cos=73000.
-- DDL 0 · txn-control(BEGIN/COMMIT) 없음 (sentinel-bypass hazard 부재).

DO $$
DECLARE
  rev_b numeric; rev_a numeric;
  pay_b bigint;  pay_a bigint;
  sc_b  bigint;  sc_a  bigint;
  cos_b numeric; cos_a numeric;
BEGIN
  SELECT single_revenue INTO rev_b FROM public.v_daily_revenue WHERE dt = DATE '2026-08-01' AND clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  SELECT count(*) INTO pay_b FROM public.payments WHERE check_in_id = 'dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf';
  SELECT count(*) INTO sc_b  FROM public.service_charges WHERE check_in_id = 'dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf';
  SELECT COALESCE(sum(price),0) INTO cos_b FROM public.check_in_services WHERE seller_staff_id = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b' AND voided_at IS NULL AND price > 0;

  INSERT INTO public.check_in_services
    (id, check_in_id, service_id, service_name, price, original_price,
     is_package_session, package_session_id, seller_staff_id,
     koh_nail_sites, koh_requested, blood_test_requested)
  VALUES
    ('ab3c1841-3557-419c-9d0d-1acbfa961c1d'::uuid,'dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf'::uuid,'89095450-223f-4863-89a9-c7f32f62809d'::uuid,'풋샴푸 (200ml)',42000,42000,false,NULL,'3a0c6774-2bd9-4018-bb38-ef6fab75d04b'::uuid,'[]'::jsonb,false,false),
    ('47eb9b88-b595-46af-a183-c32c720b6845'::uuid,'dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf'::uuid,'e17ba3a3-4842-4097-87bc-0778a64d2755'::uuid,'Care Toe Band (CTB)',15000,15000,false,NULL,'3a0c6774-2bd9-4018-bb38-ef6fab75d04b'::uuid,'[]'::jsonb,false,false),
    ('515a6214-b038-4f45-8869-5dfd1db151da'::uuid,'dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf'::uuid,'cb6443a3-fe53-40e7-bd51-a4444d8a8966'::uuid,'리페어 핸드크림 (30ml)',16000,16000,false,NULL,'3a0c6774-2bd9-4018-bb38-ef6fab75d04b'::uuid,'[]'::jsonb,false,false);

  SELECT single_revenue INTO rev_a FROM public.v_daily_revenue WHERE dt = DATE '2026-08-01' AND clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  SELECT count(*) INTO pay_a FROM public.payments WHERE check_in_id = 'dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf';
  SELECT count(*) INTO sc_a  FROM public.service_charges WHERE check_in_id = 'dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf';
  SELECT COALESCE(sum(price),0) INTO cos_a FROM public.check_in_services WHERE seller_staff_id = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b' AND voided_at IS NULL AND price > 0;

  RAISE EXCEPTION 'VG4_DRYRUN_DELTAS rev=% pay=% sc=% cos=%',
    (rev_a - COALESCE(rev_b,0)), (pay_a - pay_b), (sc_a - sc_b), (cos_a - cos_b);
END $$;
