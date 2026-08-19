-- T-20260819-foot-INFLOW-KAKAO-INBOUND-ADD
-- 방문경로/예약경로 CHECK 제약에 '카톡'(카카오톡 인바운드) 1개 ADDITIVE 추가
-- 작성: dev-foot / 2026-08-19
--
-- ⚠ 운영 적용은 supervisor DB-GATE(제약diff+롤백) + 물리 GO-token 선행 필수(§3.1 CEO 파괴게이트는 면제 — number-moving 없음·순수 ADDITIVE, 단 DDL carve 아님).
--   GO-token 前 prod apply 금지(apply_before_go 클래스). apply-gate=supervisor(NOT DA).
--   DA CONSULT-REPLY GO (MSG-20260819-115858-45sj): ADDITIVE GO·§36 firewall NEUTRAL·foot-only(cross-CRM DECOUPLE)·label=(a)'카톡' flat 확정(Q4).
--   선례 동형: 20260716160000_foot_visit_route_gonghom_add.sql ('공홈' ADD).
--
-- 순수 ADDITIVE — 기존 데이터 무손실:
--   · CHECK 제약 값 '카톡' 1개 ADD만. DROP 값 없음. 기존 7값('TM','워크인','인바운드','지인소개','네이버','인콜','공홈') 전부 존치.
--   · 기존행 물리 UPDATE 0. rename 없음. system_codes 무접촉(canonical inflow_channel §36 무접촉 — foot-LOCAL visit_route only).
--   · referral_source(§36-3 FREEZE) 무접촉·source_system 무결속·backfill 0(forward-only).
--   · 배정 라우팅(VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE·money-adjacent) 무접촉 = '카톡' 미매핑→WALK_IN 안전폴백(별건 planner 라우팅 결정).
--
-- 멱등: DROP CONSTRAINT IF EXISTS + ADD (재실행 안전). CHECK 제약은 직접 ALTER 불가 → DROP 후 superset 재생성.
-- 롤백: 20260819210000_foot_visit_route_kakao_add.rollback.sql (직전 7값 복원)
-- 적용 방법 (supervisor DB-GATE + GO-token 후):
--   supabase db push --file supabase/migrations/20260819210000_foot_visit_route_kakao_add.sql

BEGIN;

-- ============================================================
-- visit_route CHECK 제약 — '카톡' 1개 ADD (순수 ADDITIVE, 기존 7값 존치)
-- ============================================================

-- 1) customers.visit_route
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_visit_route_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개','네이버','인콜','공홈','카톡'));

COMMENT ON COLUMN public.customers.visit_route IS
  '방문경로: TM / 워크인 / 인바운드 / 지인소개 / 네이버 / 인콜 / 공홈 / 카톡 (T-...KAKAO-INBOUND-ADD: 카톡 ADD, 순수 ADDITIVE)';

-- 2) reservations.visit_route
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_visit_route_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개','네이버','인콜','공홈','카톡'));

COMMENT ON COLUMN public.reservations.visit_route IS
  'T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS + GONGHOM-ADD + KAKAO-ADD: 예약경로(방문경로 대분류).'
  ' 신규 등록 선택지=TM/네이버/인바운드/카톡/워크인/지인소개/공홈. legacy 인콜 존치. NULL=미지정.';

-- ============================================================
-- 검증 (제약 정의에 '카톡' 포함 + 기존 '공홈'/'네이버' 존치 확인)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'customers_visit_route_check'
       AND pg_get_constraintdef(oid) LIKE '%카톡%'
       AND pg_get_constraintdef(oid) LIKE '%공홈%'
       AND pg_get_constraintdef(oid) LIKE '%네이버%'
  ) THEN
    RAISE EXCEPTION 'customers_visit_route_check 카톡 ADD 또는 기존값(공홈/네이버) 존치 실패';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reservations_visit_route_check'
       AND pg_get_constraintdef(oid) LIKE '%카톡%'
       AND pg_get_constraintdef(oid) LIKE '%공홈%'
       AND pg_get_constraintdef(oid) LIKE '%네이버%'
  ) THEN
    RAISE EXCEPTION 'reservations_visit_route_check 카톡 ADD 또는 기존값(공홈/네이버) 존치 실패';
  END IF;
END $$;

COMMIT;
