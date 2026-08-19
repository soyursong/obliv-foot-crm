-- T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE — (y) visit_route keep-widen
-- 방문경로/예약경로 CHECK 제약을 최종 offered-set 으로 widen (2-table 동시·동일 set)
-- 작성: dev-foot / 2026-08-19
--
-- 근거: 김주연 총괄 최종확정 (reply_ts 1787134438.745499 '올 예리한데 아래가 최종!!', responder MSG-20260819-191804-5ezp)
--       + DA-BLESS-7 (DA CONSULT-REPLY MSG-20260819-163315-f5ey, DA-20260819-foot-INFLOW-VISITROUTE-CHECK-WIDEN-ADDITIVE-BLESS)
--       + planner NEW-TASK MSG-20260819-192510-35pv (un-block→approved).
-- 선례 동형: 20260716160000_foot_visit_route_gonghom_add.sql / 20260819210000_foot_visit_route_kakao_add.sql (2-table 대칭 superset 재생성).
--
-- ⚠ 운영 적용은 supervisor DB-GATE(MIG-GATE 2-table DDL-diff + 롤백) + 물리 GO-token 선행 필수.
--   · DA-BLESS-7: CHECK widen = ADDITIVE·firewall-neutral bless(§3.1 CEO 대표 파괴게이트 면제 — 값추가·DROP/타입변경 0·집계 불변·backfill 0)
--     이나 **MIG-GATE + 물리 GO-token 은 NOT 면제**(CHECK ADD = DDL, DDL-0 carve 아님).
--   · GO-token 前 prod apply 금지(apply_before_go 클래스). apply-gate=supervisor(NOT DA).
--   · ★2-table 원자성: customers ∧ reservations 를 **동일 widened set** 으로 동시 갱신. 1개만 widen = write fail·divergence.
--   · ★FE 드롭다운(VISIT_ROUTE_OPTIONS widen) co-deploy 동반 — CHECK widen 선(先) apply(ADDITIVE·무회귀) 후 FE deploy 안전 순서.
--
-- 순수 ADDITIVE — 기존 데이터 무손실:
--   · 기존 8값('TM','워크인','인바운드','지인소개','네이버','인콜','공홈','카톡') 전부 byte-parity 존치.
--   · 신규 8값 ADD (offered 세분/SEPARATE/기타). DROP 값 0. 기존행 물리 UPDATE 0. rename 0. backfill 0(forward-only).
--   · '재방문' = EXCLUDE 확정(미포함). '카톡' = already-live(기존 8값에 이미 포함) → 재-add 무해(멱등 superset).
--   · store-literal caveat: '임직원.가족' = 마침표('.') (system_codes 라벨 '임직원·가족' 가운데점 아님 — mirror-not-invent).
--   · system_codes(canonical inflow_channel §36 축①) 무접촉 · referral_source(§36-3) 무접촉 · source_system 무결속.
--   · 배정 라우팅(VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE·money-adjacent) 무접촉 = 신규 라벨 미매핑→WALK_IN 안전폴백(총괄 CONFIRM·money-shift 0).
--
-- 멱등: DROP CONSTRAINT IF EXISTS + ADD superset (재실행 안전). CHECK 는 직접 ALTER 불가 → DROP 후 superset 재생성.
-- 롤백: 20260819220000_foot_visit_route_offered_widen_migrate.rollback.sql (직전 8값 복원, 2-table 대칭)
-- 적용 방법 (supervisor DB-GATE + GO-token 후):
--   supabase db push --file supabase/migrations/20260819220000_foot_visit_route_offered_widen_migrate.sql

BEGIN;

-- ============================================================
-- visit_route CHECK 제약 — 최종 offered-set widen (16값 = 기존 8 존치 + 신규 8 ADD)
--   기존 8 (byte-parity): 'TM','워크인','인바운드','지인소개','네이버','인콜','공홈','카톡'
--   신규 8 (ADDITIVE)   : '인바운드(전화)','인바운드(네이버)','인바운드(공홈)',
--                         '에이전시','타센터 연계','병원 인계','임직원.가족','기타'
-- ============================================================

-- 1) customers.visit_route
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_visit_route_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN (
    'TM','워크인','인바운드','지인소개','네이버','인콜','공홈','카톡',
    '인바운드(전화)','인바운드(네이버)','인바운드(공홈)',
    '에이전시','타센터 연계','병원 인계','임직원.가족','기타'
  ));

COMMENT ON COLUMN public.customers.visit_route IS
  '방문경로(offered-set widen, T-20260818-RESV-INFLOW-WRITE-CANONICAL-MIGRATE): '
  'TM / 인바운드(전화)/인바운드(네이버)/인바운드(공홈) / 카톡 / 워크인 / 지인소개 / '
  '에이전시 / 타센터 연계 / 병원 인계 / 임직원.가족 / 기타. '
  'legacy 존치: 인바운드·네이버·공홈·인콜. 재방문 EXCLUDE. NULL=미지정. 순수 ADDITIVE.';

-- 2) reservations.visit_route (★ customers 와 byte-동일 set — 2-table 대칭 MANDATORY)
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_visit_route_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN (
    'TM','워크인','인바운드','지인소개','네이버','인콜','공홈','카톡',
    '인바운드(전화)','인바운드(네이버)','인바운드(공홈)',
    '에이전시','타센터 연계','병원 인계','임직원.가족','기타'
  ));

COMMENT ON COLUMN public.reservations.visit_route IS
  'T-...RESV-REGISTRAR-ROUTE-FIELDS + GONGHOM + KAKAO + RESV-INFLOW-WRITE-CANONICAL-MIGRATE: '
  '예약경로(방문경로 대분류). offered=TM/인바운드(전화·네이버·공홈)/카톡/워크인/지인소개/에이전시/타센터 연계/병원 인계/임직원.가족/기타. '
  'legacy 존치: 인바운드·네이버·공홈·인콜. NULL=미지정.';

-- ============================================================
-- 검증: 2-table 동일성 + 신규값 포함 + 기존값 존치 + 재방문 미포함
-- ============================================================
DO $$
DECLARE
  c_def text;
  r_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO c_def FROM pg_constraint WHERE conname = 'customers_visit_route_check';
  SELECT pg_get_constraintdef(oid) INTO r_def FROM pg_constraint WHERE conname = 'reservations_visit_route_check';

  -- 신규값 포함 (sentinel 3종: 세분/SEPARATE/기타) + 기존값 존치 (공홈/카톡/인바운드) + 재방문 미포함
  IF c_def IS NULL OR NOT (
       c_def LIKE '%인바운드(전화)%' AND c_def LIKE '%에이전시%' AND c_def LIKE '%임직원.가족%' AND c_def LIKE '%기타%'
   AND c_def LIKE '%공홈%' AND c_def LIKE '%카톡%' AND c_def LIKE '%인바운드%'
   AND c_def NOT LIKE '%재방문%'
  ) THEN
    RAISE EXCEPTION 'customers_visit_route_check widen/존치/재방문-EXCLUDE 검증 실패: %', c_def;
  END IF;

  IF r_def IS NULL OR NOT (
       r_def LIKE '%인바운드(전화)%' AND r_def LIKE '%에이전시%' AND r_def LIKE '%임직원.가족%' AND r_def LIKE '%기타%'
   AND r_def LIKE '%공홈%' AND r_def LIKE '%카톡%' AND r_def LIKE '%인바운드%'
   AND r_def NOT LIKE '%재방문%'
  ) THEN
    RAISE EXCEPTION 'reservations_visit_route_check widen/존치/재방문-EXCLUDE 검증 실패: %', r_def;
  END IF;

  -- ★2-table 대칭: constraintdef 는 CHECK 식 본문만(테이블/제약명 미포함) → 직접 동일 비교로 set 대칭 검증
  IF c_def <> r_def THEN
    RAISE EXCEPTION '2-table visit_route CHECK set 비대칭: customers=% / reservations=%', c_def, r_def;
  END IF;
END $$;

COMMIT;
