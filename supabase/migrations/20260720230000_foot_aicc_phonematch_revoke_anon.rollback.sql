-- T-20260720-foot-AICC-ANON-PII-LEAK · AC2 (뷰 봉합) · ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- 롤백 = exact prior priv 역-GRANT. prod 실측 prior privs(2026-07-20, DA positive-control):
--   DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE (= GRANT ALL 상당).
--   GRANT ALL PRIVILEGES 로 8-priv 원상 복원(MAINTAIN 포함, PG 버전별 표현차 흡수).
-- ⚠ 이 롤백은 SEV-1 누출을 재-개방한다 — 배포 회귀 등 불가피 상황에서만 사용.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT ALL PRIVILEGES ON public.aicc_crm_phone_match TO anon;

COMMIT;
