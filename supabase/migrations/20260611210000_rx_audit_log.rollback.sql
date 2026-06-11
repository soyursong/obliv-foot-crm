-- Rollback: T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK / rx_audit_log
-- 감사로그 테이블 + 정책 + 인덱스 제거. FE 의 logRxAudit 는 best-effort(실패 무시)라
-- 테이블 제거 시에도 진료(처방 적용/취소/확정)는 무중단 동작(감사 적재만 중단).

drop policy if exists "rx_audit_log_select" on public.rx_audit_log;
drop policy if exists "rx_audit_log_insert" on public.rx_audit_log;
drop index if exists public.idx_rx_audit_log_actor;
drop index if exists public.idx_rx_audit_log_clinic_date;
drop index if exists public.idx_rx_audit_log_check_in;
drop table if exists public.rx_audit_log;
