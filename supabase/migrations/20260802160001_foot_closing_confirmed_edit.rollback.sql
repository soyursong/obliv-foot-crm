-- ROLLBACK — T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK
--   20260802160001_foot_closing_confirmed_edit.sql 원복(ADDITIVE 역순 drop).
--   author: dev-foot / 2026-08-02
--
-- ⚠ 감사로그(closing_edit_log) 보존 정책:
--   기본 = 함수만 DROP(편집 진입 차단). 이미 기록된 확정편집 이력은 원장 무결성상 '보존'이 정답
--   → closing_edit_log 테이블은 기본 유지(DROP 주석처리). 완전 원복이 필요할 때만 아래 DROP TABLE 주석 해제.
--   ★herald port 소유 DDL(daily_closings.revision / daily_closing_confirm_guard / enqueue)은 절대 건드리지 않음.

BEGIN;

-- 1) RPC 제거(확정 후 해제없는 수정 진입 차단 — 기존 재오픈 동선은 무영향)
DROP FUNCTION IF EXISTS public.closing_confirmed_edit(uuid,date,integer,integer,integer,text,jsonb,jsonb);

-- 2) 감사로그 테이블 — 기본 보존(원장 무결성). 완전 원복 시에만 아래 3줄 주석 해제.
-- DROP POLICY IF EXISTS closing_edit_log_read ON public.closing_edit_log;
-- DROP INDEX IF EXISTS public.idx_closing_edit_log_closing;
-- DROP INDEX IF EXISTS public.idx_closing_edit_log_clinic_date;
-- DROP TABLE IF EXISTS public.closing_edit_log;

COMMIT;
