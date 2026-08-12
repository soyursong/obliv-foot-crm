-- T-20260813-foot-DEFAULTACL-ANON-FORWARD-REVOKE · UP
-- per-CRM 실행 leg of xcrm 우산 T-20260813-xcrm-DEFAULTACL-ANON-FORWARD-HARDEN
-- DA CONSULT GO(CONDITIONAL, MSG-20260813-010554-o1w6) → approved.
-- ════════════════════════════════════════════════════════════════════════════
-- FORWARD-HARDEN: postgres 가 public 스키마에 앞으로 생성하는 신규 테이블에 anon 이
--   default-privilege 로 자동 상속받던 권한을 회수한다. 신규 base 테이블 생성 시 anon 이
--   설계 의도 없이 SELECT/MAINTAIN/REFERENCES/TRIGGER 를 자동 취득하는 forward 누출 경로를 봉인.
--
-- 실측 prod pg_default_acl (introspection BEFORE, 2026-08-13):
--   grantor=postgres · schema=public · objtype=TABLE(r) · grantee=anon 잔존 default-grant =
--     { MAINTAIN, REFERENCES, SELECT, TRIGGER }  →  REVOKE ALL 로 전량 회수.
--   evidence: db-gate/T-20260813-foot-DEFAULTACL-ANON-FORWARD-REVOKE_introspect_BEFORE.log
--
-- ★ 무엇을 바꾸지 않는가 (중요 — forward-only):
--   · ALTER DEFAULT PRIVILEGES 는 "앞으로 생성될" 오브젝트에만 적용된다. 이미 존재하는
--     테이블의 explicit anon grant(예: 셀프체크인 동선 테이블의 명시적 SELECT 등)에는
--     무영향. 따라서 현재 라이브 anon consumer(self-checkin / health-q / RLS 경유)는 무손상.
--   · 정당 anon consumer 부재 확인: anon 이 "신규 테이블 default-grant 상속"에 의존하는
--     경로 = 0 (앱은 명시적 grant + SECDEF RPC + RLS 로 동작. 신규 테이블 자동상속 의존 없음).
--   · 경로(b) grantor=supabase_admin ADP FULL(anon, public/graphql/graphql_public) = DA Q3
--     §15-6-7 accepted-residual REAFFIRM → 본 마이그 무접촉(42501 ceiling · app 테이블 무발현).
--   · schema=storage 의 postgres→anon default(Supabase 관리 영역) = 스코프 밖 · 무접촉.
--
-- 멱등: REVOKE(미보유분=no-op). 데이터 mutation 0. DDL=ALTER DEFAULT PRIVILEGES 1문.
-- 가역: rollback = GRANT 로 default-privilege 재부여(20260813000000_..._forward_revoke.rollback.sql).
-- 게이트: exposure-reducing·가역 → §3.1 CEO 파괴게이트 면제 · CEO NOTIFY 불요.
--   supervisor DB-GATE DDL-diff + GO-token 선행 필수(apply_before_go 금지). dev prod apply 는
--   GO-token 발행 후에만.
-- author: dev-foot / 2026-08-13 · ticket: T-20260813-foot-DEFAULTACL-ANON-FORWARD-REVOKE
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;

COMMIT;
