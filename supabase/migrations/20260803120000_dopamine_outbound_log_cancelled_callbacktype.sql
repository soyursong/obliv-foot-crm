-- T-20260702-foot-CANCEL-SENDER-ENV-WIRING — dopamine_outbound_log.callback_type CHECK 확장
--
-- ROOT CAUSE (AC3 e2e 2026-08-03 런타임 발견):
--   원본 마이그레이션 20260520000040_dopamine_integration_schema.sql:74 이
--     callback_type text NOT NULL CHECK (callback_type IN ('visited', 'paid'))
--   로 정의됨. T-20260527-dopamine-RESV-CANCEL-SYNC 로 sender EF `dopamine-callback`에
--   'cancelled' 경로(§260~)가 추가됐으나 물리 CHECK 제약이 미갱신.
--   → sender EF 가 outbound_log INSERT(callback_type='cancelled') 시 23514 위반
--   → 500 INTERNAL("...violates check constraint dopamine_outbound_log_callback_type_check")
--   → cancel-sync 자동 sender 경로 전면 불가 (env·인증 문제 아님).
--
-- change-class: ADDITIVE (허용값 확장). 기존 'visited'/'paid' 행 무영향, 파괴 없음.
--   'cancelled' 는 cross_crm_data_contract.md §6 canonical callback_type — 신규 도메인값 도입이 아니라
--   물리 CHECK 를 이미 계약된 값에 맞추는 forward reconciliation.
--
-- 코드 전수확인(2026-08-03): dopamine_outbound_log 에 INSERT 되는 callback_type 은
--   {'visited','paid','cancelled'} 3종뿐 (dopamine-callback/index.ts, checkin-visited-fire/index.ts).
--   'reschedule' 는 별도 테이블 dopamine_callback_outbox.event_type — 본 제약 무관.
--
-- ※ 운영 DB 스키마 변경 — supervisor 사전승인(GO) 후 적용. 미적용 상태로 커밋됨.
-- rollback: 20260803120000_..._cancelled_callbacktype.down.sql

BEGIN;

ALTER TABLE public.dopamine_outbound_log
  DROP CONSTRAINT IF EXISTS dopamine_outbound_log_callback_type_check;

ALTER TABLE public.dopamine_outbound_log
  ADD CONSTRAINT dopamine_outbound_log_callback_type_check
  CHECK (callback_type IN ('visited', 'paid', 'cancelled'));

COMMIT;
