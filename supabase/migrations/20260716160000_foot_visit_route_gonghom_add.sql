-- T-20260716-foot-VISITROUTE-OPT-GONGHOM-ADD-NAVER-ALIGN
-- 방문경로/예약경로 CHECK 제약에 '공홈'(공식 홈페이지) 1개 ADDITIVE 추가
-- 작성: dev-foot / 2026-07-16
--
-- ⚠ 운영 적용은 supervisor DDL-diff 게이트(대표 게이트 면제, autonomy §3.1 — 순수 ADDITIVE).
--   DA CONSULT-REPLY v2 MSG-20260716-005653-nh69 (SUPERSEDES pvs0): GO, 순수 ADDITIVE 단일 신규값('공홈' 1개). CHECK=7값(기존6+'공홈'). pvs0의 8값/'네이버야'는 reporter 정정(no7d)으로 무효.
--
-- 순수 ADDITIVE — 기존 데이터 무손실:
--   · CHECK 제약 값 '공홈' 1개 ADD만. DROP 값 없음. 기존 6값('TM','워크인','인바운드','지인소개','네이버','인콜') 전부 존치.
--   · 기존행 물리 UPDATE 0. '네이버' 존치·rename 없음('네이버야' 미도입).
--   · route_std 매핑 '공홈'→homepage (신규 canonical, owned homepage=organic) — silver transform + DA reply 정본 소관.
--     ★ 배포순서: silver route_std '공홈'→homepage 등록이 본 CHECK+FE 배포보다 선행/동시(orphan 0). 안전망=unmapped→other+count 알람.
--   · system_codes 무접촉(DA 확정 — 갱신 불요/지연).
--
-- 멱등: DROP CONSTRAINT IF EXISTS + ADD (재실행 안전). CHECK 제약은 직접 ALTER 불가 → DROP 후 superset 재생성.
-- 롤백: 20260716160000_foot_visit_route_gonghom_add.rollback.sql (직전 6값 복원)
-- 적용 방법 (supervisor DDL-diff 후 db-gate 실행):
--   supabase db push --file supabase/migrations/20260716160000_foot_visit_route_gonghom_add.sql

BEGIN;

-- ============================================================
-- visit_route CHECK 제약 — '공홈' 1개 ADD (순수 ADDITIVE, 기존 6값 존치)
-- ============================================================

-- 1) customers.visit_route
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_visit_route_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개','네이버','인콜','공홈'));

COMMENT ON COLUMN public.customers.visit_route IS
  '방문경로: TM / 워크인 / 인바운드 / 지인소개 / 네이버 / 인콜 / 공홈 (T-...GONGHOM-ADD: 공홈 ADD, 순수 ADDITIVE)';

-- 2) reservations.visit_route
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_visit_route_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개','네이버','인콜','공홈'));

COMMENT ON COLUMN public.reservations.visit_route IS
  'T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS + GONGHOM-ADD: 예약경로(방문경로 대분류).'
  ' 신규 등록 선택지=TM/네이버/인바운드/워크인/지인소개/공홈. legacy 인콜 존치. NULL=미지정.';

-- ============================================================
-- 검증 (제약 정의에 '공홈' 포함 + 기존 '네이버' 존치 확인)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'customers_visit_route_check'
       AND pg_get_constraintdef(oid) LIKE '%공홈%'
       AND pg_get_constraintdef(oid) LIKE '%네이버%'
  ) THEN
    RAISE EXCEPTION 'customers_visit_route_check 공홈 ADD 또는 네이버 존치 실패';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reservations_visit_route_check'
       AND pg_get_constraintdef(oid) LIKE '%공홈%'
       AND pg_get_constraintdef(oid) LIKE '%네이버%'
  ) THEN
    RAISE EXCEPTION 'reservations_visit_route_check 공홈 ADD 또는 네이버 존치 실패';
  END IF;
END $$;

COMMIT;
