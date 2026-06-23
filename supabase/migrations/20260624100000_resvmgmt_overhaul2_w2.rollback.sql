-- ROLLBACK: T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB
-- (1) reservations.brief_note DROP
-- (2) visit_route CHECK 제약을 원래 4값('TM','워크인','인바운드','지인소개')으로 복원.
--     ⚠ 롤백 전 '네이버'/'인콜' 값을 가진 행이 있으면 CHECK 재생성이 실패한다.
--        → 먼저 해당 행을 NULL 또는 기존 값으로 정리 후 롤백할 것(데이터 보존 판단은 운영).
--
-- 적용: supabase db push --file supabase/migrations/20260624100000_resvmgmt_overhaul2_w2.rollback.sql

BEGIN;

-- (2) CHECK 제약 원복 (4값)
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_visit_route_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개'));

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_visit_route_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개'));

-- (1) brief_note DROP
ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS brief_note;

COMMIT;
