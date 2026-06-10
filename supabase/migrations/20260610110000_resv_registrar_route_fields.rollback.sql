-- ROLLBACK: T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS
--
-- 복원 내용 (생성 역순 — 의존성 안전):
--   1. reservations.registrar_name / registrar_id 컬럼 DROP (registrar_id DROP 으로 FK 의존 해제)
--   2. reservation_registrars 트리거·함수 DROP
--   3. reservation_registrars 테이블 DROP (RLS 정책은 테이블과 함께 제거됨)
--   4. reservations.visit_route CHECK 제약 + 컬럼 DROP
--
-- ⚠ 주의: 컬럼/테이블 DROP 시 그동안 저장된 예약경로·예약등록자·마스터 명단 데이터 유실.
--         데이터 보존이 필요하면 해당 DROP 만 생략 가능(스키마는 additive 였으므로 컬럼 잔존 무해).
--
-- 적용 방법 (supervisor 실행):
--   supabase db push --file supabase/migrations/20260610110000_resv_registrar_route_fields.rollback.sql

BEGIN;

-- ─── 1. reservations 참조 컬럼 제거 (registrar_id DROP → FK 의존 해제 선행) ───
ALTER TABLE public.reservations DROP COLUMN IF EXISTS registrar_name;
ALTER TABLE public.reservations DROP COLUMN IF EXISTS registrar_id;

-- ─── 2. 트리거·함수 제거 ───
DROP TRIGGER  IF EXISTS trg_reservation_registrars_updated_at ON public.reservation_registrars;
DROP FUNCTION IF EXISTS update_reservation_registrars_updated_at();

-- ─── 3. 마스터 테이블 제거 (RLS 정책 동반 제거) ───
DROP TABLE IF EXISTS public.reservation_registrars;

-- ─── 4. 예약경로 컬럼 + CHECK 제거 ───
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_visit_route_check;
ALTER TABLE public.reservations DROP COLUMN IF EXISTS visit_route;

COMMIT;
