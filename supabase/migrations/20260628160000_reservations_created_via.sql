-- T-20260628-crm-RESV-CREATED-VIA-FILL §2 (dev-foot, co_assignee)
-- 예약 생성경로(created_via) 적재용 컬럼 + CHECK 추가.
-- enum SSOT v1.1 (canonical, crm과 단일 공유): [manual, dopamine, aicc, naver, meta, inbound, selfbook, kakao, walkin]
-- ★ ADDITIVE: 신규 NULL 허용 컬럼 + CHECK(NULL OR IN 9값) → 기존행 전부 통과 무손실. PG11+ instant add, write 0.
--   (DA CONSULT-REPLY GO/ADDITIVE 2026-06-28 19:04. supervisor DDL-diff 대상.)
--   ※ 풋 reservations 에는 created_via 컬럼이 부재(롱레와 달리) → ADD COLUMN 포함. 여전히 ADDITIVE.
-- 롤백: 20260628160000_reservations_created_via.rollback.sql

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS created_via text;

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_created_via_check;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_created_via_check
  CHECK (created_via IS NULL OR created_via IN (
    'manual', 'dopamine', 'aicc', 'naver', 'meta', 'inbound', 'selfbook', 'kakao', 'walkin'
  ));

COMMENT ON COLUMN public.reservations.created_via IS
  '예약 생성경로 (write-path). enum v1.1 9값: manual(어드민 수기)|dopamine(도파민 push)|aicc|naver|meta|inbound(전화)|selfbook(셀프북)|kakao|walkin(현장). NULL=미수집(소급 backfill 별건). T-20260628-crm-RESV-CREATED-VIA-FILL';
