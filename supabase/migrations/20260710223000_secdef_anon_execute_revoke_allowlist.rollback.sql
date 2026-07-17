-- ROLLBACK: T-20260710-foot-SECDEF-ANON-REVOKE  ★ SUPERSEDED / INERT NO-OP (2026-07-18) ★
-- forward 마이그가 CLOSE-AS-SUPERSEDED(inert no-op) 되어 되돌릴 대상이 없다.
-- forward 는 prod 에 apply 된 적 없음(proacl-only, schema_migrations 원장 무기재).
-- 어떤 회귀도 유발하지 않으므로 롤백 불요. 이력 보존 + inert 유지 목적의 no-op.
SELECT 'T-20260710-foot-SECDEF-ANON-REVOKE rollback superseded (no-op)' AS note;
