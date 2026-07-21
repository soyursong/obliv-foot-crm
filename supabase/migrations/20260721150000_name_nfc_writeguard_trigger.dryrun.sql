-- DRY-RUN (No-Persistence Protocol): T-20260721-foot AC-2 name NFC write-guard 무영속 검증
-- 방식: 트리거/함수 생성 → 대표 write 경로(INSERT)에 NFD 샘플 주입 → 저장값이 NFC 로 정규화됐는지 계측
--       → RAISE EXCEPTION 강제 unwind(COMMIT 없음 → sentinel-bypass 불가). up.sql 은 txn-control 내장 없음.
-- 기대: NFD 입력(자모분해)이 저장 직전 NFC 로 교정(char_length 9 → 3).
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_name_nfc_writeguard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'customers' THEN
    IF NEW.name IS NOT NULL THEN NEW.name := normalize(NEW.name, NFC); END IF;
  ELSIF TG_TABLE_NAME = 'reservations' THEN
    IF NEW.customer_name IS NOT NULL THEN NEW.customer_name := normalize(NEW.customer_name, NFC); END IF;
    IF NEW.customer_real_name IS NOT NULL THEN NEW.customer_real_name := normalize(NEW.customer_real_name, NFC); END IF;
  ELSIF TG_TABLE_NAME = 'check_ins' THEN
    IF NEW.customer_name IS NOT NULL THEN NEW.customer_name := normalize(NEW.customer_name, NFC); END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_name_nfc_writeguard ON public.customers;
CREATE TRIGGER trg_name_nfc_writeguard BEFORE INSERT OR UPDATE OF name ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.fn_name_nfc_writeguard();

DO $$
DECLARE
  -- NFD(자모분해) 샘플 = conjoining jamo 9 codepoint. NFC 후 3 음절.
  --   U+1100 U+1161 U+11BC / U+1109 U+1173 U+11BC / U+110B U+1173 U+11AB
  v_nfd  text := E'\u1100\u1161\u11bc\u1109\u1173\u11bc\u110b\u1173\u11ab';   -- 진짜 NFD 9 codepoint (ASCII escape=디코딩시 자모분해)
  v_len_in  int;
  v_len_stored int;
  v_id uuid;
  v_clinic uuid;
BEGIN
  v_len_in := char_length(v_nfd);   -- 기대 9
  SELECT id INTO v_clinic FROM public.clinics LIMIT 1;

  INSERT INTO public.customers (clinic_id, name, phone, visit_type)
  VALUES (v_clinic, v_nfd, '+821000000000', 'new')
  RETURNING id, char_length(name) INTO v_id, v_len_stored;

  RAISE NOTICE 'DRYRUN write-guard: input NFD len=% → stored len=% (기대 3=NFC). NFC-equal=%',
    v_len_in, v_len_stored, (v_len_stored = char_length(normalize(v_nfd, NFC)));

  IF v_len_stored <> char_length(normalize(v_nfd, NFC)) THEN
    RAISE EXCEPTION 'DRYRUN FAIL: write-guard 가 NFD 를 NFC 로 정규화하지 못함 (stored len=%)', v_len_stored;
  END IF;

  RAISE EXCEPTION 'DRYRUN OK — 강제 unwind (무영속). stored len=% == NFC len=%', v_len_stored, char_length(normalize(v_nfd, NFC));
END $$;

ROLLBACK;

-- POST-PROBE (무영속 재확인, 별도 세션 read-only):
--   SELECT tgname FROM pg_trigger WHERE tgname='trg_name_nfc_writeguard';  -- 기대 0건(트리거 미영속)
--   SELECT count(*) FROM public.customers WHERE phone='+821000000000';      -- 기대 0건(INSERT 미영속)
