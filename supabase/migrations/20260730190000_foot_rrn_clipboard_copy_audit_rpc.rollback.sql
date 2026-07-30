-- ROLLBACK — T-20260730-foot-RRN-CLIPBOARD-COPY-NHIS 클립보드 반출 감사 RPC
DROP FUNCTION IF EXISTS public.log_rrn_clipboard_copy(uuid);
-- ⚠ phi_access_log 테이블 DROP 금지 (공유 cross-CRM 감사 테이블, 타 소비자 존재).
-- ⚠ phi_access_log 의 PUBLIC/anon EXECUTE 재부여 금지.
-- 기록된 access_type='rrn_clipboard_copy' 행은 감사 원장(append-only) → 삭제 불요.
