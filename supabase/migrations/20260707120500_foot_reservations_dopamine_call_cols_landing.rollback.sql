-- ROLLBACK: 20260707120500_foot_reservations_dopamine_call_cols_landing.sql
-- T-20260707-foot-RESERVATIONS-DOPAMINE-COLS-LANDING (part b)
--
-- 무손실 schema 원복: 3컬럼 DROP → reservations 스키마가 착지 이전 상태로 복귀.
-- ⚠ 데이터 소실 주석: DROP 시 그간 축적된 도파민 콜마킹(prevention/cancellation call 완료 플래그,
--   no_show 클릭 시각)이 함께 소멸한다. 롤백 전 잔여 마킹 건수 확인 권장:
--     SELECT count(*) FILTER (WHERE prevention_call_done)   AS prevention,
--            count(*) FILTER (WHERE cancellation_call_done) AS cancellation,
--            count(*) FILTER (WHERE no_show_clicked_at IS NOT NULL) AS no_show
--       FROM public.reservations;
-- 풋 FE 는 read-only(optional 필드) 이므로 컬럼 부재 시에도 graceful(undefined-safe) — 예약 동선 무영향.

BEGIN;

ALTER TABLE public.reservations DROP COLUMN IF EXISTS prevention_call_done;
ALTER TABLE public.reservations DROP COLUMN IF EXISTS cancellation_call_done;
ALTER TABLE public.reservations DROP COLUMN IF EXISTS no_show_clicked_at;

-- 원장 원복(선택): 정본=prod 실재. 롤백 시 원장에서도 제거하려면 아래 주석 해제.
-- DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260707120500';

COMMIT;
