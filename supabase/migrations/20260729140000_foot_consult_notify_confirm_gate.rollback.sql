-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY (변경2 발송상태 게이트)
--   (20260729140000_foot_consult_notify_confirm_gate.sql)
-- ══════════════════════════════════════════════════════════════════
-- 역연산: check_ins 에 추가한 제약(2) + ADDITIVE nullable 4컬럼 DROP.
--   순수 nullable(DEFAULT 없음) 컬럼 제거 → 기존 배정/매출귀속/RLS 무영향.
--   무접촉: consultant_id / customers.assigned_consultant_id / payments / assignment_actions.
-- 멱등: DROP CONSTRAINT IF EXISTS → DROP COLUMN IF EXISTS. (제약 먼저 제거해야 컬럼 DROP 안전.)
-- ⚠ 발송이력(consult_notify_*) 데이터 소실 — 롤백은 배포 취소 시 한정.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.check_ins DROP CONSTRAINT IF EXISTS fk_check_ins_consult_notify_by;
ALTER TABLE public.check_ins DROP CONSTRAINT IF EXISTS chk_check_ins_consult_notify_status;

ALTER TABLE public.check_ins DROP COLUMN IF EXISTS consult_notify_slack_ts;
ALTER TABLE public.check_ins DROP COLUMN IF EXISTS consult_notify_by;
ALTER TABLE public.check_ins DROP COLUMN IF EXISTS consult_notify_sent_at;
ALTER TABLE public.check_ins DROP COLUMN IF EXISTS consult_notify_status;

COMMIT;
