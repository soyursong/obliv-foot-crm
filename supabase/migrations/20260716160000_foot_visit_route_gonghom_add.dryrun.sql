-- DRY-RUN (No-Persistence): T-20260716-foot-VISITROUTE-OPT-GONGHOM-ADD-NAVER-ALIGN
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · up.sql 은 COMMIT(txn-control)을 포함 = sentinel-bypass hazard 존재 → 본 dry-run 은 COMMIT 을 strip 하고
--     BEGIN..ROLLBACK 로 감싸 무영속 보장. txn 내부 assertion 실패 시 RAISE 'DRYRUN-FAIL' → 배치 abort.
--   · 사후 무영속(post-probe)은 runner 의 별 트랜잭션(독립 API 콜)에서 CHECK 정의에 '공홈' 부재 재확인.
BEGIN;

-- customers.visit_route CHECK 재생성 (공홈 ADD)
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_visit_route_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개','네이버','인콜','공홈'));

-- reservations.visit_route CHECK 재생성 (공홈 ADD)
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_visit_route_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개','네이버','인콜','공홈'));

-- assertion: '공홈' ADD + '네이버' 존치 (customers/reservations 양측)
DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'customers_visit_route_check'
       AND pg_get_constraintdef(oid) LIKE '%공홈%'
       AND pg_get_constraintdef(oid) LIKE '%네이버%'
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: customers_visit_route_check 공홈 ADD/네이버 존치 검증 실패';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reservations_visit_route_check'
       AND pg_get_constraintdef(oid) LIKE '%공홈%'
       AND pg_get_constraintdef(oid) LIKE '%네이버%'
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: reservations_visit_route_check 공홈 ADD/네이버 존치 검증 실패';
  END IF;
  -- 기존행 위반 0 검사(순수 ADDITIVE → superset 이므로 위반 불가, 방어적 확인)
  IF EXISTS (
    SELECT 1 FROM public.customers
     WHERE visit_route IS NOT NULL
       AND visit_route NOT IN ('TM','워크인','인바운드','지인소개','네이버','인콜','공홈')
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: customers.visit_route 신규 CHECK 위반 행 존재';
  END IF;
END $chk$;

ROLLBACK;
