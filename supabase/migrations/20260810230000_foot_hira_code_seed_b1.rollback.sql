-- T-20260810-foot-INS-HIRACODE-SEED (B-1) — rollback
-- 본 마이그레이션이 시드한 4종 hira_code 를 NULL 로 되돌린다.
-- 안전: id + hira_code 값 정확일치 가드 → 본 마이그가 채운 행만 되돌림(타 경로가 이후 다른 값을 넣었으면 무접촉).

UPDATE public.services SET hira_code = NULL
  WHERE id = 'de611ed5-154a-475d-9eb3-19d6d3bad881' AND hira_code = 'AA154';   -- 초진진찰료-의원

UPDATE public.services SET hira_code = NULL
  WHERE id = '117befad-e8f8-48c6-b496-89c37a68a441' AND hira_code = 'AA254';   -- 재진진찰료-의원

UPDATE public.services SET hira_code = NULL
  WHERE id = '1a82c70a-07fe-4321-be44-8a206e3d1aa0' AND hira_code = 'AA222';   -- 재진-물리치료,주사 등

UPDATE public.services SET hira_code = NULL
  WHERE id = '03189fa2-0536-4676-bc5d-ad5283a48a0c' AND hira_code = 'M0111';   -- 단순처치 [1일]
