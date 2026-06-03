-- ROLLBACK T-20260603-foot-RX-SUPER-PHRASE: super_phrases 제거
-- 주의: 등록된 슈퍼상용구 데이터 전부 소실. 롤백 전 백업 필수.
-- 레거시(phrase_templates / prescription_sets) 무영향 (자체보유 테이블, FK 없음).
DROP POLICY IF EXISTS "admin_write_super_phrases" ON public.super_phrases;
DROP POLICY IF EXISTS "staff_read_super_phrases"  ON public.super_phrases;
DROP TABLE IF EXISTS public.super_phrases;
