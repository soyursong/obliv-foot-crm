-- ============================================================
-- Migration: cband_payment_attempts L2 in-flight 잠금 = 승인(0210) 전용으로 narrowing
-- Ticket: T-20260804-foot-CBAND-CANCEL-PAYLOCK-RELEASE-REPAY  (증분-6 / AC-11)
-- ============================================================
-- SSOT: memory/_handoff/tickets/T-20260804-foot-CBAND-CANCEL-PAYLOCK-RELEASE-REPAY.md
--   [증분-6/AC-11] 취소(S1)를 환자단위 결제 동시성 잠금에서 '완전 분리'.
--   근거: 동시성 잠금의 목적 = 중복 '승인'(이중결제) 방지. 취소(0430/S1)에는 구조적으로 해당 없음.
--   → 취소 요청 경로가 환자단위 in-flight('결제 진행 중') 잠금을 '참조하지 않도록' L2 partial UNIQUE 를
--     tran_type='0210'(승인) 전용으로 좁힌다. 취소 attempt(0430)는 이 인덱스에 더 이상 참여하지 않음.
--
-- 왜 DDL 인가 (RCA · dev-foot):
--   기존 L2 = partial UNIQUE(clinic_id, check_in_id) WHERE status='requested' AND check_in_id IS NOT NULL
--     — tran_type 무관 → 취소(0430) insert-first 'requested' 행이 동일 환자의 '진짜 in-flight 승인(0210)' 행과
--       충돌(23505) → CbandConcurrentPaymentError('patient_in_progress') → 취소가 결제잠금에 오차단(시나리오8).
--   client-only 대안은 모두 부적합:
--     · 취소 attempt.check_in_id=NULL 로 인덱스 회피 → probeConcurrent 의 hasLiveCompletedPayment(취소상쇄 감지)가
--       cband 취소행(check_in 스코프)에 의존하므로, 취소 후 재결제 '이미 결제된 환자' 오안내 재발(시나리오1 파손).
--     · 초기 status 를 'requested' 외로 삽입 → insert-first 상태머신 불변식 위반.
--   → 인덱스 술어를 승인 전용으로 좁히는 것이 유일한 audit-보존·불변식-보존 해법.
--
-- 무엇 (원자 교체):
--   DROP ux_cband_pa_inflight_checkin → CREATE 동명 인덱스 + WHERE ... AND tran_type = '0210'.
--   승인(0210) 시도만 '체크인당 in-flight 1건' DB 백스톱 유지(이중결제 방어 = AC-3/AC-4 무회귀).
--   취소(0430)는 인덱스 미참여 → 환자단위 결제잠금과 완전 분리(AC-11). 취소 중복은 좁은 잠금으로만 방지:
--     (a) CbandTerminalCancelButton AC-5 재취소 가드(원거래 AUTHNO 로 refund 존재 확인 → 미전송),
--     (b) 이미 취소된 건 재취소 시 카드사 8325 거부.
--
-- change-class = 제약 narrowing(파괴변경 아님·컬럼/테이블/enum 신설 0). 기존 승인 잠금 동작 무변, 취소만 exempt.
--   ⚠ db_change=true(마이그 존재) → risk#1 게이트: data-architect CONSULT + supervisor DDL-diff 선행(deploy-ready 전).
--   ⚠ 이중결제 방어 불변식(L1 msg_trace UNIQUE / L2 승인 in-flight / payments.payment_attempt_id partial UNIQUE) 보존.
--
-- 무회귀: 승인(0210) 경로 인덱스 술어 실질 동일(status='requested' AND check_in_id NOT NULL) + tran_type='0210' 추가만.
--   prod 위반행 리스크 0(신규 인덱스가 더 좁음 = 기존 통과행은 전부 통과). 취소 중복행이 과거 존재해도 인덱스 재생성 성공.
-- rollback: 20260804210000_foot_cband_inflight_lock_approve_only.rollback.sql
-- dryrun  : 20260804210000_foot_cband_inflight_lock_approve_only.dryrun.mjs (No-Persistence: txn-strip + sentinel unwind + post-probe)
-- ============================================================

BEGIN;

-- L2 재정의: 승인(0210) 전용 in-flight 잠금. 취소(0430)는 참여 제외(AC-11 완전 분리).
DROP INDEX IF EXISTS public.ux_cband_pa_inflight_checkin;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cband_pa_inflight_checkin
  ON public.cband_payment_attempts (clinic_id, check_in_id)
  WHERE status = 'requested' AND check_in_id IS NOT NULL AND tran_type = '0210';

COMMENT ON INDEX public.ux_cband_pa_inflight_checkin IS
  '체크인당 in-flight(requested) 승인(0210) 1건 — 이중결제 DB 백스톱(L2). 취소(0430)는 제외(AC-11 완전 분리, T-20260804-foot-CBAND-CANCEL-PAYLOCK-RELEASE-REPAY 증분-6). 취소 중복은 재취소 가드(AC-5)+카드사 8325 로 방지.';

COMMIT;
