-- ROLLBACK — T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT / FIX-6yfd
-- 20260730203000_foot_payment_sync_outbox_grant.sql 역
--
-- ⚠ 주의: 이 REVOKE 는 crm-payment-sync-emit EF / drain cron 의 outbox 접근을 차단한다
--   (EF 500 permission denied 재유발). 긴급 롤백 시에만 사용. 통상 GRANT 는 유지.
--   단, foot 프로젝트 default privileges 가 service_role 에 별도 부여했을 수 있으므로(2026-07-30 실측 TRUE),
--   본 REVOKE 후에도 default-privileges 경로로 권한이 잔존할 수 있음(무해 — GRANT 취지 유지 방향).

BEGIN;

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.payment_sync_outbox FROM service_role;

COMMIT;
