-- T-20260720-foot-AICC-ANON-PII-LEAK · AC3 (베이스 봉합 2/2 — customers anon lockdown) · UP
-- ════════════════════════════════════════════════════════════════════════════
-- SEV-1 LIVE PHI 읽기 누출 봉합 (3/3) — customers anon 직접 SELECT 완전 제거 → reach 504→0.
--
-- ⚠⚠ 배포 게이트: 본 마이그는 foot-checkin FE 컷오버(SelfCheckIn.tsx L1760 → fn_selfcheckin_resolve_customer_id_by_phone)
--   가 prod 라이브 반영된 뒤에만 적용한다. 순서 역전 시 검증예약 상류갭 fallback 이 (짧게) 파손.
--   선행조건: (1) 20260720231000 RPC 마이그 prod 적용 완료 (2) foot-checkin 컷오버 번들 CF 배포 확인.
--
-- 봉합 대상 (실측 prod, 2026-07-20):
--   · 정책 anon_select_customer_self_checkin (SELECT, {anon}, USING clinic_id IS NOT NULL) → DROP.
--   · anon customers grant = SELECT (실측: anon 은 customers 에 SELECT 만 보유) → REVOKE SELECT.
--   ⇒ 적용 후 anon 은 customers 에 어떤 권한도·행-가시성도 없음 → PostgREST anon SELECT reach = 0.
--
-- 보존 (건드리지 않음):
--   · anon_insert_customer_self_checkin (INSERT 정책) — anon INSERT grant 은 이미 회수됨(ANONSWEEP
--     T-20260715)이라 dead(PostgREST INSERT 불가) → 잔존 무해, 본 티켓 스코프 밖. 미변경.
--   · authenticated 정책 10종(customers_staff_select 등) — 스태프 동선. 미변경.
--   · SECDEF RPC(resolve_v3/dup_guard/verify_reservation/... + 본 티켓 resolve_customer_id_by_phone)
--     = owner=postgres definer → RLS/grant 우회 → REVOKE SELECT 무영향. 정당 셀프체크인 전량 보존.
--
-- 멱등: DROP POLICY IF EXISTS + REVOKE(미보유=no-op) = 자연 멱등. 데이터 mutation 0.
-- 롤백: 20260720232000_foot_customers_anon_select_lockdown.rollback.sql (정책 재생성 + GRANT SELECT).
-- 게이트: owner=postgres → supervisor DDL-diff DB-GATE + MIG-GATE 4필드. CEO 게이트 불요(비파괴·가역).
-- AC4: 적용 후 anon positive-control 재실행 → 504/504 → 0 확인 + 정당 셀프체크인 회귀0.
-- author: dev-foot / 2026-07-20 · ticket: T-20260720-foot-AICC-ANON-PII-LEAK (AC3)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS anon_select_customer_self_checkin ON public.customers;

REVOKE SELECT ON public.customers FROM anon;

COMMIT;
