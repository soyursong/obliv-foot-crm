-- DRY-RUN (No-Persistence): T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE — (y) visit_route keep-widen
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · up.sql 은 COMMIT(txn-control)을 포함 = sentinel-bypass hazard 존재 → 본 dry-run 은 COMMIT 을 strip 하고
--     BEGIN..ROLLBACK 로 감싸 무영속 보장. txn 내부 assertion 실패 시 RAISE 'DRYRUN-FAIL' → 배치 abort.
--   · 사후 무영속(post-probe)은 runner 의 별 트랜잭션(독립 API 콜)에서 CHECK 정의에 신규값 부재 재확인.
BEGIN;

-- customers.visit_route CHECK 재생성 (16값 widen)
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_visit_route_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN (
    'TM','워크인','인바운드','지인소개','네이버','인콜','공홈','카톡',
    '인바운드(전화)','인바운드(네이버)','인바운드(공홈)',
    '에이전시','타센터 연계','병원 인계','임직원.가족','기타'
  ));

-- reservations.visit_route CHECK 재생성 (동일 16값)
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_visit_route_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN (
    'TM','워크인','인바운드','지인소개','네이버','인콜','공홈','카톡',
    '인바운드(전화)','인바운드(네이버)','인바운드(공홈)',
    '에이전시','타센터 연계','병원 인계','임직원.가족','기타'
  ));

-- assertion: 신규값 ADD(세분/SEPARATE/기타) + 기존값 존치(공홈/카톡/인바운드) + 재방문 미포함 + 2-table 대칭 + 기존행 위반 0
DO $chk$
DECLARE
  c_def text;
  r_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO c_def FROM pg_constraint WHERE conname = 'customers_visit_route_check';
  SELECT pg_get_constraintdef(oid) INTO r_def FROM pg_constraint WHERE conname = 'reservations_visit_route_check';

  IF c_def IS NULL OR NOT (
       c_def LIKE '%인바운드(전화)%' AND c_def LIKE '%인바운드(네이버)%' AND c_def LIKE '%인바운드(공홈)%'
   AND c_def LIKE '%에이전시%' AND c_def LIKE '%타센터 연계%' AND c_def LIKE '%병원 인계%'
   AND c_def LIKE '%임직원.가족%' AND c_def LIKE '%기타%'
   AND c_def LIKE '%공홈%' AND c_def LIKE '%카톡%' AND c_def LIKE '%인바운드%'
   AND c_def NOT LIKE '%재방문%'
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: customers_visit_route_check widen/존치/재방문-EXCLUDE 검증 실패: %', c_def;
  END IF;

  IF r_def IS NULL OR NOT (
       r_def LIKE '%인바운드(전화)%' AND r_def LIKE '%인바운드(네이버)%' AND r_def LIKE '%인바운드(공홈)%'
   AND r_def LIKE '%에이전시%' AND r_def LIKE '%타센터 연계%' AND r_def LIKE '%병원 인계%'
   AND r_def LIKE '%임직원.가족%' AND r_def LIKE '%기타%'
   AND r_def LIKE '%공홈%' AND r_def LIKE '%카톡%' AND r_def LIKE '%인바운드%'
   AND r_def NOT LIKE '%재방문%'
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: reservations_visit_route_check widen/존치/재방문-EXCLUDE 검증 실패: %', r_def;
  END IF;

  -- ★2-table 대칭 (constraintdef 는 CHECK 식 본문만 → 직접 동일 비교)
  IF c_def <> r_def THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 2-table visit_route CHECK set 비대칭: customers=% / reservations=%', c_def, r_def;
  END IF;

  -- 기존행 위반 0 (순수 ADDITIVE → superset 이므로 위반 불가, 방어적 확인)
  IF EXISTS (
    SELECT 1 FROM public.customers
     WHERE visit_route IS NOT NULL
       AND visit_route NOT IN (
         'TM','워크인','인바운드','지인소개','네이버','인콜','공홈','카톡',
         '인바운드(전화)','인바운드(네이버)','인바운드(공홈)',
         '에이전시','타센터 연계','병원 인계','임직원.가족','기타')
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: customers.visit_route 신규 CHECK 위반 행 존재';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reservations
     WHERE visit_route IS NOT NULL
       AND visit_route NOT IN (
         'TM','워크인','인바운드','지인소개','네이버','인콜','공홈','카톡',
         '인바운드(전화)','인바운드(네이버)','인바운드(공홈)',
         '에이전시','타센터 연계','병원 인계','임직원.가족','기타')
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: reservations.visit_route 신규 CHECK 위반 행 존재';
  END IF;
END $chk$;

ROLLBACK;
