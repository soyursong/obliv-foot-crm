-- T-20260625-foot-FOREIGN-LANG-SAVE — 국적 자동연결 언어값 고객정보 저장
-- DA 게이트: CONSULT-REPLY MSG-20260625-131444-2prw (DA-20260625-FOOT-FOREIGN-LANG-CANON, GO + ADDITIVE)
--   · canonical 컬럼 = customers.language  (preferred_language 기각 — derm 운영컬럼 정합)
--   · 값 포맷 = BCP-47 코드(ko/en/ja/zh-CN/zh-TW …). 표시명 저장 금지(집계·cross-CRM 조인 정합).
--   · DB CHECK 없음(derm customers.language 선례 정합) → FE LANGUAGE_OPTIONS 앱레벨 검증 의무.
--   · 등록폼 국적 자동연결(본 티켓) + 셀프접수 에픽 Phase1이 단일 customers.language 컬럼 공유(중복 컬럼 금지).
--
-- 안전: ADDITIVE only · IF NOT EXISTS · nullable · 백필 없음 · 내국인 동선 무영향
-- 롤백: 20260625140000_foreign_lang_save_customers_language.rollback.sql

BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS language TEXT;

COMMENT ON COLUMN public.customers.language IS
  '환자 선호 언어 BCP-47 코드(ko/en/ja/zh-CN/zh-TW …). 국적 선택 시 FE COUNTRY_DEFAULT_LANGUAGE로 자동 제안·저장. DB CHECK 없음(FE LANGUAGE_OPTIONS 검증). T-20260625-foot-FOREIGN-LANG-SAVE';

COMMIT;
