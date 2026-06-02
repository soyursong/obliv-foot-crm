-- T-20260602-foot-SELFCHECKIN-DUP-GUARD (P0) — DB 레벨 이중 방어 (partial UNIQUE index)
--
-- ⛔⛔ 게이트 (GO_WARN) — 본 마이그레이션은 사전조사·dedupe 완료 전까지 실행 금지 ⛔⛔
--   production check_ins 사전조사(2026-06-02, dev-foot) 결과:
--     [A] (clinic_id, customer_id, KST-day) status<>cancelled 활성 중복 = 41개 그룹 존재.
--         → 본 UNIQUE index 생성 시 즉시 실패(23505). dedupe 선행 필수.
--         (최대 21/12/7건은 QA 흔적, 일부 최근(06-01 등)은 실데이터 가능성 → 행별 사람 확인.)
--     [B] (clinic_id, reservation_id) 활성 중복 = 0개.
--         → reservation-side 는 기존 인덱스 unique_reservation_checkin(cancelled 제외, T-20260529)
--           이 이미 커버. 본 마이그레이션은 reservation 인덱스를 재생성하지 않는다(중복 회피).
--
--   실행 조건(불변):
--     1) scripts/dedupe_checkins_walkin_daily_dryrun.sql 로 중복 row 목록 산출(dry-run, READ-ONLY).
--     2) 대표/총괄이 정리 대상 행별 confirm.
--     3) 확인된 행만 정리(예: 활성 1건 유지·나머지 status='cancelled' 또는 삭제).
--     4) 재조사 중복 0건 → 그 다음 본 index 생성.
--   supervisor 단독 게이트(GO_WARN) — dev-foot 은 생성만, 실행은 supervisor 가 검토 후 수행.
--
-- ─── 인덱스 ──────────────────────────────────────────────────────────────────
-- idx_checkins_walkin_daily: clinic_id + customer_id + created_at(KST date) 당 활성 체크인 1개 한정.
--   status NOT IN ('cancelled') 부분 인덱스 → 취소건 제외(AC-5), 날짜 단위(AC-4).
--   워크인/신규 customer_id 가 식별되면 동일고객 당일 2회 INSERT 를 23505 로 차단(최종 방어).
--   FE/RPC 가드가 1차, 본 인덱스가 동시성 레이스 최종 방어(AC-3 graceful 23505 매핑과 짝).
--
-- 롤백: 20260602200010_checkins_walkin_daily_unique.rollback.sql
-- ticket: T-20260602-foot-SELFCHECKIN-DUP-GUARD
-- author: dev-foot / 2026-06-02

BEGIN;

-- KST 날짜 기준 partial UNIQUE — IMMUTABLE 표현식 필요.
-- (created_at AT TIME ZONE 'Asia/Seoul')::date 는 timestamptz→KST 고정 변환으로 인덱스 가능.
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_walkin_daily
  ON public.check_ins (
    clinic_id,
    customer_id,
    ((created_at AT TIME ZONE 'Asia/Seoul')::date)
  )
  WHERE status NOT IN ('cancelled') AND customer_id IS NOT NULL;

COMMENT ON INDEX idx_checkins_walkin_daily IS
  'T-20260602-foot-SELFCHECKIN-DUP-GUARD: clinic+customer 당 당일(KST) 활성 체크인 1개 한정.'
  ' cancelled 제외(AC-5), KST date 단위(AC-4). 워크인 포함 동일고객 당일 중복 INSERT 차단.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'check_ins' AND indexname = 'idx_checkins_walkin_daily'
  ) THEN
    RAISE EXCEPTION 'ASSERT FAILED: idx_checkins_walkin_daily 인덱스 생성 실패';
  END IF;
  RAISE NOTICE 'T-20260602-foot-SELFCHECKIN-DUP-GUARD: idx_checkins_walkin_daily 생성 완료.';
END;
$$;

COMMIT;
