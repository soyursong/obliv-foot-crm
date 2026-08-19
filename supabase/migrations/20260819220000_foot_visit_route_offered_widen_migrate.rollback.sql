-- ROLLBACK: T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE — (y) visit_route keep-widen
-- visit_route CHECK 제약을 직전 8값('TM','워크인','인바운드','지인소개','네이버','인콜','공홈','카톡')으로 복원
--   = 신규 8값('인바운드(전화)','인바운드(네이버)','인바운드(공홈)','에이전시','타센터 연계','병원 인계','임직원.가족','기타') 제거.
--   ⚠ 롤백 전 신규 8값 中 하나를 가진 행이 있으면 CHECK 재생성이 실패한다.
--      → 먼저 해당 행을 NULL 또는 기존 값으로 정리 후 롤백할 것(데이터 보존 판단은 운영).
--   ★2-table 대칭: customers ∧ reservations 동시 복원.
--
-- 적용: supabase db push --file supabase/migrations/20260819220000_foot_visit_route_offered_widen_migrate.rollback.sql

BEGIN;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_visit_route_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개','네이버','인콜','공홈','카톡'));

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_visit_route_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개','네이버','인콜','공홈','카톡'));

COMMIT;
