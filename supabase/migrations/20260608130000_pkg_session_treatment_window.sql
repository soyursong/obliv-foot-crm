-- ============================================================
-- T-20260608-foot-TICKET-DEDUCT-SLOT-DATA  (AC4)
-- 차감 이력(package_sessions)에 치료 시작~종료 구간 컬럼 추가
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-06-08
-- 롤백: 20260608130000_pkg_session_treatment_window.rollback.sql
--
-- ⚠️ STATUS: DRAFT — supervisor 마이그 게이트 승인 대기 (아직 미적용)
--   ⓠ2 코드그라운딩 결론: package_sessions 에 치료 시작~종료 구간 컬럼 부재.
--   슬롯 구간 소스 = status_transitions(전이 로그) → 치료중 슬롯 [entered_at, exited_at].
--   AC4: 슬롯 카운트 시 확보되는 치료 시작~종료 구간을 차감 레코드에 주입.
--
-- risk: additive · nullable · DEFAULT NULL.
--   기존 row·정렬·집계(get_package_remaining / computeRemainingFromSessionRows) 무영향.
--   GO 후보 (0/5) — supervisor 최종 판정.
-- ============================================================

BEGIN;

ALTER TABLE public.package_sessions
  ADD COLUMN IF NOT EXISTS treatment_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS treatment_ended_at   TIMESTAMPTZ;

COMMENT ON COLUMN public.package_sessions.treatment_started_at IS
  'T-20260608-foot-TICKET-DEDUCT-SLOT-DATA AC4: 치료 시작 시각(치료중 슬롯 진입). status_transitions 기반 슬롯 구간 시작.';
COMMENT ON COLUMN public.package_sessions.treatment_ended_at IS
  'T-20260608-foot-TICKET-DEDUCT-SLOT-DATA AC4: 치료 종료 시각(치료중 슬롯 이탈/완료). status_transitions 기반 슬롯 구간 종료.';

COMMIT;
