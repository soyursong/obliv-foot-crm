-- ROLLBACK — T-20260724-foot-NHIS-MANUAL-CAPTURE 조회 감사 RPC (DA SSOT §롤백 SQL 힌트)
DROP FUNCTION IF EXISTS public.log_nhis_eligibility_lookup(uuid);
-- ⚠ phi_access_log 테이블 DROP 금지 (공유 cross-CRM 감사 테이블, RRN 등 타 소비자 존재).
-- ⚠ phi_access_log 의 PUBLIC/anon EXECUTE 재부여 금지.
-- 기록된 access_type='nhis_eligibility_lookup' 행은 감사 원장(append-only) → 삭제 불요.
