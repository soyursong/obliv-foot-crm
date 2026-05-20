-- T-20260520-foot-DOPAMINE-SCHEMA (TA1)
-- 풋CRM ↔ 도파민 양방향 연동 스키마 마이그레이션
-- 스펙: memory/_handoff/spec_foot_dopamine_integration_20260520.md §9
--
-- 선행 상태 확인 (2026-05-20):
--   reservations.source_system TEXT → 이미 존재 (20260513000050_reservations_source_system.sql)
--   reservations.external_id TEXT   → 이미 존재, 데이터 없음 (TEXT 타입 유지, UUID 호환 문자열)
--   idx_reservations_source_external → 이미 존재
--
-- 이 마이그레이션에서 추가하는 것:
--   1) reservations.external_id TEXT→UUID 타입 변환 (데이터 없음, 안전)
--   2) payments.external_id uuid 컬럼 추가
--   3) dopamine_outbound_log 테이블 생성 (멱등 + 재시도)
--
-- 롤백: 20260520000040_dopamine_integration_schema.down.sql
-- 기존 데이터 영향 없음 (ADD COLUMN NULL default, external_id 데이터 없어 타입변환 안전)

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- 1) reservations.external_id: TEXT → UUID 타입 변환
--    도파민 cue_card.id (UUID) 직접 저장 위해 타입 통일
--    기존 데이터: 모두 NULL (검증 완료) → USING 캐스트 안전
-- ─────────────────────────────────────────────────────────────────
-- source_system, external_id 컬럼은 20260513에서 이미 생성됨 (IF NOT EXISTS 로 no-op 보장)
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS source_system text,
  ADD COLUMN IF NOT EXISTS external_id   text;

-- external_id TEXT → UUID 변환 (데이터 없어 안전)
ALTER TABLE public.reservations
  ALTER COLUMN external_id TYPE uuid USING external_id::uuid;

COMMENT ON COLUMN public.reservations.source_system IS
  '예약 유입 경로: null=일반/워크인, ''dopamine''=도파민 TM 경유, ''foot-walkin''=풋 자체 워크인';
COMMENT ON COLUMN public.reservations.external_id IS
  '도파민 cue_card.id (UUID) — 큐카드 master=도파민 모델. NULL이면 도파민 미연동 예약';

-- 멱등성 UNIQUE partial index (이미 있으면 no-op)
-- 기존: idx_reservations_source_external (20260513에서 생성)
-- 이 마이그레이션은 동일 조건으로 중복 생성 안 함 — 기존 인덱스 유지
-- (이름만 다른 중복 인덱스 방지)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'reservations'
      AND indexname = 'uq_reservations_source_external'
  ) THEN
    -- idx_reservations_source_external 가 이미 동일 역할 수행 중이므로 별칭 생성만
    -- 실질적 인덱스는 기존 것 재사용 (중복 인덱스 생성 불필요)
    NULL; -- 기존 인덱스 충분, 신규 생성 스킵
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────
-- 2) payments.external_id — 도파민 cue_card.id carry-over
--    reservation의 external_id를 carry-over하여 paid 콜백 발사 시 사용
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS external_id uuid;

COMMENT ON COLUMN public.payments.external_id IS
  '도파민 cue_card.id carry-over. paid 콜백 발사 시 사용. NULL=도파민 비연동';

-- ─────────────────────────────────────────────────────────────────
-- 3) dopamine_outbound_log — Reverse 콜백 멱등 + 재시도 추적
--    visited/paid 콜백 발사 결과를 기록
--    UNIQUE(callback_type, event_id) → 중복 발사 방지
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dopamine_outbound_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id      uuid        NOT NULL,
  callback_type    text        NOT NULL CHECK (callback_type IN ('visited', 'paid')),
  event_id         text        NOT NULL,
  payload          jsonb       NOT NULL,
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'sent', 'duplicate', 'failed')),
  http_status      int,
  response_body    text,
  attempts         int         NOT NULL DEFAULT 0,
  last_attempt_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (callback_type, event_id)
);

COMMENT ON TABLE public.dopamine_outbound_log IS
  '도파민 Reverse 콜백(visited/paid) 발사 로그 — 멱등 + 재시도 안전망. T-20260520-foot-DOPAMINE-SCHEMA';
COMMENT ON COLUMN public.dopamine_outbound_log.callback_type IS
  '''visited'' = 셀프QR 체크인 내원, ''paid'' = 첫 패키지 결제 (1회만 발사)';
COMMENT ON COLUMN public.dopamine_outbound_log.event_id IS
  '풋 측 멱등키: visited=check_ins.id, paid=payments.id (text 형태로 저장)';
COMMENT ON COLUMN public.dopamine_outbound_log.status IS
  'pending=발사 대기, sent=성공, duplicate=중복(applied:false), failed=실패';

-- 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_dopamine_outbound_log_external_id
  ON public.dopamine_outbound_log(external_id);

CREATE INDEX IF NOT EXISTS idx_dopamine_outbound_log_status_created
  ON public.dopamine_outbound_log(status, created_at DESC);

-- ─────────────────────────────────────────────────────────────────
-- RLS: dopamine_outbound_log는 Edge Function(service_role)만 접근
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.dopamine_outbound_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dopamine_outbound_log_service_role_only"
  ON public.dopamine_outbound_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
