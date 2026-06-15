-- ============================================================
-- AC-2 APPLY — #7 reservations.is_healer_intent  (컬럼 ADD 부분만)
-- T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT
-- ============================================================
-- planner 판정: 컬럼 ADD 만 GO. 동봉 backfill UPDATE 는 데이터변경(AC-3 경계) → 분리.
--   backfill 은 별도 datafix 티켓(supabase/migrations/20260615T-is_healer_intent_backfill.datafix.sql)
--   으로 끊으며 본 배치에서 적용 금지.
-- ADDITIVE: NOT NULL DEFAULT false 컬럼 추가. 기존 행은 즉시 false 채워짐(테이블 rewrite 無, PG11+ fast-default).
-- FE: 이미 is_healer_intent 기대(42703/PGRST204 graceful 재시도, RESVPOPUP-3BUG AC2). 미적용 시 healer_flag fallback.
-- 게이트: data-architect CONSULT(#A 동봉) GO + supervisor DDL-diff 후 _pg --apply.
-- 롤백: H7_is_healer_intent_column.rollback.sql
-- author: dev-foot / 2026-06-15
-- ============================================================

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS is_healer_intent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.reservations.is_healer_intent IS
  '힐러 의도(영속) — 예약 팝업 힐러 ON/OFF 토글로 설정. 체크인 후에도 유지되는 힐러 분류 SSOT. healer_flag(1회성 HL-blink 소모)와 분리. (T-20260614-foot-HEALER-RESV-CLASSIFY-DEF)';
