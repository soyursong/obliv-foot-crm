-- Migration: T-20260630-foot-CONSENT-MARKETING-COL-ROLLBACK
-- customers.consent_marketing DROP — 비-SSOT divergent 명칭 수렴 복원 (DA NO-GO as-named).
--
-- 배경:
--   T-...CUSTOMERS-CONSENT-MARKETING-COL 에서 DA CONSULT-REPLY 도착 전 consent_marketing
--   컬럼을 추가·배포(a9f4da16). 직후 DA = NO-GO as-named (consent_marketing = 비-SSOT 7번째
--   divergent 명칭, 모든 경우 금지). 배포된 컬럼 = cross-CRM 수렴 깨는 drift → DROP 으로 복원.
--
-- 게이트 (DA-20260630-foot-CONSENT-MARKETING-COL-ROLLBACK / 대표게이트 면제 autonomy §3.1):
--   • 가드A: foot push 수신 경로 outbox/DLQ/retry 백로그 in-flight consent_marketing 페이로드 = 0 확인
--   • 가드B: foot ingest EF(reservation-ingest-from-dopamine) consent_marketing 조건부 write 동반 제거
--   • ★HARD pre-DROP: SELECT count(*) FROM customers WHERE consent_marketing IS TRUE = 0 (확인됨)
--                     → placeholder(false)만 보유, 실 광고동의 0건 = 유실 0
--   • dopamine push EF emit 중단 선행(T-...REMOVE deployed/Green 09:54:06/09944c2) = dead path
--
-- 요건 보존: 명칭만 폐기 ≠ 마케팅동의 기능 폐기. 광고성 동의 canonical 거처 = consent_ad
--           (schema_registry §3-1, derm live). foot 향후 실 광고동의 캡처 필요 시 → consent_ad
--           B-path 복귀(consent_marketing 재추가 금지).
--
-- 적용: node scripts/apply_20260630160000_foot_customers_consent_marketing_drop.mjs

BEGIN;

ALTER TABLE public.customers
  DROP COLUMN IF EXISTS consent_marketing;

COMMIT;

NOTIFY pgrst, 'reload schema';
