-- DRY-RUN: T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL  (FOLD-IN 개정)
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · txn-control(BEGIN/COMMIT) 미사용. 단일 plpgsql DO 블록 내에서 UPDATE 실행 후 마지막에
--     RAISE EXCEPTION 으로 강제 unwind → 어떤 변경도 persist 안 됨(sentinel-bypass 불가: COMMIT 없음).
--   · 트리거 cascade(reservations/check_ins) 효과도 같은 트랜잭션 내에서 계측 후 함께 rollback.
--   · 실행 후 별도 read-only post-probe 로 무영속(NFD 원상=cust3/aicc3) 재확인 필수.
--
-- 실행: node scripts/T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL_dryrun.mjs  (read_only:false, no-persistence)

DO $$
DECLARE
  v_cust_aff INT;
  v_nfd_cust INT; v_nfd_resv INT; v_nfd_chk INT; v_nfd_aicc INT;
  v_srch INT;   -- 검색재현 = chart# 기준 char_length=3(NFC) 확인 (실명 리터럴 미기재, PHI 위생)
BEGIN
  -- customers 만 UPDATE (트리거 cascade→resv/chk, aicc-view 자동). aicc 는 VIEW 라 직접 UPDATE 안 함.
  UPDATE public.customers c SET name = normalize(c.name, NFC)
   WHERE c.id IN ('b734f069-5a06-414b-9ad6-f32ee3b3bf2c','f137fe98-30b2-4a66-bcc0-73bc68277b58','0fc0752c-7ccd-4a71-85ec-b7e4e5f20527')
     AND c.name IS NOT NULL AND char_length(c.name) <> char_length(normalize(c.name,NFC));
  GET DIAGNOSTICS v_cust_aff = ROW_COUNT;

  SELECT count(*) INTO v_nfd_cust FROM public.customers            WHERE name IS NOT NULL          AND char_length(name)          <> char_length(normalize(name,NFC));
  SELECT count(*) INTO v_nfd_resv FROM public.reservations         WHERE customer_name IS NOT NULL AND char_length(customer_name) <> char_length(normalize(customer_name,NFC));
  SELECT count(*) INTO v_nfd_chk  FROM public.check_ins            WHERE customer_name IS NOT NULL AND char_length(customer_name) <> char_length(normalize(customer_name,NFC));
  SELECT count(*) INTO v_nfd_aicc FROM public.aicc_crm_phone_match WHERE name IS NOT NULL          AND char_length(name)          <> char_length(normalize(name,NFC));
  SELECT count(*) INTO v_srch FROM public.customers WHERE chart_number='F-4903' AND char_length(name)=char_length(normalize(name,NFC));   -- 백필 후 기대 1(NFC)

  -- 강제 unwind(no-persistence). affected/사후상태를 예외 메시지로 방출.
  RAISE EXCEPTION 'DRYRUN(no-persist): cust_aff=% | 사후 NFD cust=% resv=% chk=% aicc(view)=% | 검색재현(F-4903 NFC)=%',
    v_cust_aff, v_nfd_cust, v_nfd_resv, v_nfd_chk, v_nfd_aicc, v_srch;
END $$;
