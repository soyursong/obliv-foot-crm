-- T-20260610-foot-RESV-DUPGUARD-SAMEDAY (P1) — DB 레벨 이중 방어 (partial UNIQUE index)
--
-- ⛔⛔ 게이트 (GO_WARN) — 본 마이그레이션은 사전조사·dedupe 완료 전까지 실행 금지 ⛔⛔
--   production reservations 사전조사(2026-06-10, dev-foot,
--     scripts/dedupe_reservations_customer_daily_dryrun.mjs) 결과:
--     (clinic_id, customer_id, reservation_date) status<>cancelled 활성 중복 = 13개 그룹 존재.
--       → 본 UNIQUE index 생성 시 즉시 실패(23505). dedupe 선행 필수.
--       (행별confirm필요 11 / QA일괄정리 2. 일부는 본 버그 자체의 증거 — checked_in + 신규 confirmed.)
--     phone-only(customer_id NULL) 중복 = 0개 → index 미커버 영역 위반 없음(FE/RPC 가드가 방어).
--
--   실행 조건(불변):
--     1) scripts/dedupe_reservations_customer_daily_dryrun.mjs 로 중복 row 목록 산출(dry-run, READ-ONLY).
--        산출물: scripts/out/resv_dedupe_dryrun_report.md (+ .json)
--     2) 대표/총괄이 정리 대상 행별 confirm.
--     3) 확인된 행만 정리(예: 활성 1건 유지·나머지 status='cancelled' 논리삭제).
--     4) 재조사 중복 0건 → 그 다음 본 index 생성.
--   supervisor 단독 게이트(GO_WARN) — dev-foot 은 생성만, 실행은 supervisor 가 검토 후 수행.
--
-- ─── 인덱스 ──────────────────────────────────────────────────────────────────
-- idx_reservations_customer_daily: clinic_id + customer_id + reservation_date 당 활성 예약 1개 한정.
--   status NOT IN ('cancelled') 부분 인덱스 → 취소건 제외(AC-3), reservation_date 단위(AC-4).
--   동일고객 당일 2회 INSERT 를 23505 로 차단(최종 동시성 방어).
--   FE/RPC 가드(fn_reservation_dup_guard) 가 1차, 본 인덱스가 레이스 최종 방어.
--
-- 롤백: 20260610100010_reservations_customer_daily_unique.rollback.sql
-- ticket: T-20260610-foot-RESV-DUPGUARD-SAMEDAY
-- author: dev-foot / 2026-06-10

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_customer_daily
  ON public.reservations (
    clinic_id,
    customer_id,
    reservation_date
  )
  WHERE status NOT IN ('cancelled') AND customer_id IS NOT NULL;

COMMENT ON INDEX idx_reservations_customer_daily IS
  'T-20260610-foot-RESV-DUPGUARD-SAMEDAY: clinic+customer 당 당일(reservation_date) 활성 예약 1개 한정.'
  ' cancelled 제외(AC-3), reservation_date 단위(AC-4). 동일고객 당일 중복 INSERT 차단(최종 방어).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'reservations' AND indexname = 'idx_reservations_customer_daily'
  ) THEN
    RAISE EXCEPTION 'ASSERT FAILED: idx_reservations_customer_daily 인덱스 생성 실패';
  END IF;
  RAISE NOTICE 'T-20260610-foot-RESV-DUPGUARD-SAMEDAY: idx_reservations_customer_daily 생성 완료.';
END;
$$;

COMMIT;
