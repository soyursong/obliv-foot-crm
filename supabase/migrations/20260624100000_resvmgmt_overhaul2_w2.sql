-- T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB
-- 예약관리 개편2탄 WAVE 2 — DB 변경 묶음 (item 2/3/8/10)
-- 작성: dev-foot / 2026-06-24
--
-- ⚠ 운영 적용은 supervisor DDL-diff 게이트(대표 게이트 면제, autonomy §3.1).
--   DA CONSULT-REPLY MSG-20260623-182336-igq8: 둘 다 GO + 순수 ADDITIVE.
-- additive only — 기존 데이터 무손실(컬럼 추가 + CHECK 제약 값 ADD만, DROP 값 없음).
--
-- 변경 2종:
--   (1) reservations.brief_note TEXT NULL — 초진 간략메모(발톱무좀/내성발톱 등). CRM-local 임상 메타.
--       전용 컬럼 채택(DA 후보 a). memo 오버로드(b) 비권장(registry §640 referral_source 선례).
--   (2) visit_route CHECK 에 '네이버','인콜' ADD. 기존 'TM','워크인','인바운드','지인소개' 존치(B안=비파괴).
--       customers_visit_route_check + reservations_visit_route_check 동시 갱신.
--       ★ route_std 매핑 정본(contract §364-366): '네이버'→naver / '인콜'→inbound / legacy '인바운드'→inbound.
--       ★ 이름충돌 경고: cue_cards.media_source='naver'(paid) ≠ foot.visit_route '네이버'(수기 inbound). 혼용 금지.
--       ★ system_codes(SSOT) value ADD 는 data-architect/dopamine 도메인(별도 repo) — 본 마이그는 foot CRM DB CHECK 만 갱신.
--
-- 롤백: 20260624100000_resvmgmt_overhaul2_w2.rollback.sql
-- 적용 방법 (supervisor DDL-diff 후 db-gate 실행):
--   supabase db push --file supabase/migrations/20260624100000_resvmgmt_overhaul2_w2.sql

BEGIN;

-- ============================================================
-- SECTION 1: reservations.brief_note (초진 간략메모)
-- ============================================================
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS brief_note TEXT;

COMMENT ON COLUMN public.reservations.brief_note IS
  'T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB: 예약 간략메모(초진 주증상 — 발톱무좀/내성발톱 선택 또는 직접입력).'
  ' CRM-local 임상 메타(cue_card·통계·리드 집계 영향 0). 예약메모(booking_memo)와 별개 칸.';

-- ============================================================
-- SECTION 2: visit_route CHECK 제약 — '네이버','인콜' ADD (B안: 기존 값 전부 존치)
--   CHECK 제약은 직접 ALTER 불가 → DROP 후 superset 으로 재생성. 기존 데이터 위반 0(값 추가만).
-- ============================================================

-- 2-1) customers.visit_route
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_visit_route_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개','네이버','인콜'));

COMMENT ON COLUMN public.customers.visit_route IS
  '방문경로: TM / 워크인 / 인바운드 / 지인소개 / 네이버 / 인콜 (T-...W2-DB: 네이버·인콜 ADD, B안 인바운드 존치)';

-- 2-2) reservations.visit_route
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_visit_route_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개','네이버','인콜'));

COMMENT ON COLUMN public.reservations.visit_route IS
  'T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS + W2-DB: 예약경로(방문경로 대분류).'
  ' 신규 등록 선택지=TM/네이버/인콜/워크인/지인소개(5종). legacy 인바운드 존치(B안). NULL=미지정.';

-- ============================================================
-- 검증
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'reservations' AND column_name = 'brief_note'
  ) THEN
    RAISE EXCEPTION 'reservations.brief_note 컬럼 추가 실패';
  END IF;
  -- CHECK 제약이 '네이버' 를 허용하는지 확인 (INSERT 테스트 없이 제약 정의 존재만 검사)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reservations_visit_route_check'
       AND pg_get_constraintdef(oid) LIKE '%네이버%'
  ) THEN
    RAISE EXCEPTION 'reservations_visit_route_check 네이버 추가 실패';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'customers_visit_route_check'
       AND pg_get_constraintdef(oid) LIKE '%인콜%'
  ) THEN
    RAISE EXCEPTION 'customers_visit_route_check 인콜 추가 실패';
  END IF;
END $$;

COMMIT;
