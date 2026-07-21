-- ROLLBACK: T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL
-- 백필 적용을 되돌린다 = customers.name 을 원값(NFD, 자모분해) 으로 복원.
--   원값 = census freeze 스냅샷(scripts/T-...BACKFILL_freeze.json)의 name_hex_raw (UTF8 hex).
--   convert_from(decode(hex,'hex'),'UTF8') 로 원 NFD 바이트열을 정확 복원(정규화 무손실).
--
-- ⚠ 롤백 사유가 "정규화 자체를 되돌린다"인 경우는 드묾(정정 방향이 정답).
--   주 용도 = 예상밖 side-effect 발견 시 원상복구 안전판. clinic 격리(PK 자체가 jongno 한정).

BEGIN;

UPDATE public.customers SET name = convert_from(decode('e18487e185a2e186a8e18486e185b5e186abe18489e185a5e186a8','hex'),'UTF8')
  WHERE id = 'b734f069-5a06-414b-9ad6-f32ee3b3bf2c';   -- F-4818 백민석 (NFD 원값)

UPDATE public.customers SET name = convert_from(decode('e18480e185a1e186bce18489e185b3e186bce1848be185b3e186ab','hex'),'UTF8')
  WHERE id = 'f137fe98-30b2-4a66-bcc0-73bc68277b58';   -- F-4903 강승은 (NFD 원값)

UPDATE public.customers SET name = convert_from(decode('e1848ee185a5e186abe18489e185b3e186bce18492e185aae186ab','hex'),'UTF8')
  WHERE id = '0fc0752c-7ccd-4a71-85ec-b7e4e5f20527';   -- F-4920 천승환 (NFD 원값)

-- 복원 검증(기대: raw_len 9 = NFD 복원 확인)
DO $$
DECLARE v_nfd INT;
BEGIN
  SELECT count(*) INTO v_nfd FROM public.customers
   WHERE id IN ('b734f069-5a06-414b-9ad6-f32ee3b3bf2c','f137fe98-30b2-4a66-bcc0-73bc68277b58','0fc0752c-7ccd-4a71-85ec-b7e4e5f20527')
     AND char_length(name) <> char_length(normalize(name,NFC));
  RAISE NOTICE '[ROLLBACK] NFD 복원 확인 = % (기대 3)', v_nfd;
END $$;

COMMIT;
