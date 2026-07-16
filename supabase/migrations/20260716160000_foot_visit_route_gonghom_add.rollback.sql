-- ROLLBACK: T-20260716-foot-VISITROUTE-OPT-GONGHOM-ADD-NAVER-ALIGN
-- visit_route CHECK 제약을 직전 6값('TM','워크인','인바운드','지인소개','네이버','인콜')으로 복원 = '공홈' 제거.
--   ⚠ 롤백 전 '공홈' 값을 가진 행이 있으면 CHECK 재생성이 실패한다.
--      → 먼저 해당 행을 NULL 또는 기존 값으로 정리 후 롤백할 것(데이터 보존 판단은 운영).
--
-- 적용: supabase db push --file supabase/migrations/20260716160000_foot_visit_route_gonghom_add.rollback.sql

BEGIN;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_visit_route_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개','네이버','인콜'));

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_visit_route_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개','네이버','인콜'));

COMMIT;
