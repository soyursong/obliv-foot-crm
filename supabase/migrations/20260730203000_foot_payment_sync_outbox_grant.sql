-- T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT — payment_sync_outbox service_role GRANT (FIX-6yfd)
--
-- ══ 배경 (planner FIX-REQUEST MSG-20260730-203041-6yfd / supervisor 경고 MSG-863t) ══
--   선행 마이그 20260730200000 이 payment_sync_outbox 를 CREATE 하면서 GRANT 문 0건.
--   scalp2 자매 레인 flip 실집행 실측 → EF 500 `permission denied for table payment_sync_outbox`.
--   RC = 마이그 GRANT 부재. foot prod 실측(2026-07-30 20:39): service_role 4권한이 프로젝트 default
--   privileges 로 이미 TRUE(body 와 동형)이나, 이는 프로젝트-config 축 우연 → 마이그가 명시 GRANT 를
--   보유해야 default-privileges 상태와 무관하게 재현 가능(belt-and-suspenders, scratch-deploy 안전).
--
-- ══ change-class = ADDITIVE ══
--   GRANT 만(신규/변경 스키마 0, DROP/ALTER/backfill 0). drain cron + crm-payment-sync-emit EF 가
--   service_role 로 outbox read(SELECT) + 상태 write(INSERT/UPDATE) + 정리(DELETE) 하므로 4권한 필요.
--   GRANT 는 자연 멱등(재적용 무해). RLS(20260730200000 ENABLE, 0 policy)로 anon/authenticated 격리 유지.
--
-- 롤백: 20260730203000_foot_payment_sync_outbox_grant.rollback.sql
-- 작성: dev-foot / 2026-07-30 · ticket: T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT (FIX-6yfd)

BEGIN;

-- service_role EF/cron 전용 4권한 명시 부여(멱등). flip 시 permission denied 재발 차단.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_sync_outbox TO service_role;

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECK (supervisor)
-- [ ] has_table_privilege('service_role','public.payment_sync_outbox','SELECT,INSERT,UPDATE,DELETE') = 4/4 true
-- [ ] EMIT dark 유지(PAYMENT_SYNC_EMIT_ENABLED=false) — flip 은 별도 supervisor 게이트
-- ============================================================
