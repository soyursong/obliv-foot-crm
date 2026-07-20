-- T-20260720-foot-AICC-ANON-PII-LEAK · AC2 (뷰 봉합) · UP
-- ════════════════════════════════════════════════════════════════════════════
-- SEV-1 LIVE PHI 읽기 누출 봉합 (1/3) — aicc_crm_phone_match 뷰 anon 권한 전량 회수.
--
-- 실측 근거 (DA positive-control + dev-foot usage-baseline, prod rxlomoozakkjesdqjtvd READ-ONLY):
--   · 뷰 viewdef = SELECT id AS customer_id, clinic_id, name, phone, created_at FROM customers
--     → name·phone 직접 투영. security_invoker=on.
--   · 뷰 anon privs = GRANT ALL 미회수 (실측: DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE).
--   · anon 소비자 = 0건 (obliv-foot-crm src grep 0 · foot-checkin src grep 0 · scripts/audit 픽스처만).
--     ⇒ REVOKE ALL = zero regression 확정 (AC1 CONSULT, commit fea39f7f).
--
-- ─── AC5 forward-doc 정정 (baseline L9649 주석 = prod상 거짓 확정) ───────────────
--   prod 스키마 baseline(L9649) 주석 'anon PII revokes preserved' 는 거짓이었다:
--   foot aicc_crm_phone_match 뷰의 anon 회수 이력 0건 = 문서-실재 divergence. 본 마이그가 실재 정정.
--   ⚠ FORK-TEMPLATE 전파차단: 이 뷰의 GRANT ALL 은 fork-template(초기 스키마) 상속물이다.
--     신규 CRM fork 시 aicc_crm_phone_match(또는 유사 PHI-투영 뷰)를 GRANT ALL 로 anon 에 열지 말 것.
--     PHI 투영 뷰의 anon 접근은 default DENY — 필요 시 SECDEF RPC(id-only/masked)로만 노출.
--
-- 멱등: REVOKE 는 자연 멱등(미보유 권한 회수=no-op). 데이터 mutation 0(권한 메타 acl만).
-- 롤백: 20260720230000_foot_aicc_phonematch_revoke_anon.rollback.sql (exact prior priv 역-GRANT).
-- 게이트: owner=postgres → supervisor DDL-diff DB-GATE. 신규 컬럼/테이블/enum 0 → DA CONSULT 비해당.
--         비파괴 보안조임·가역 → CEO 게이트 불요(§8/autonomy §3.1).
-- author: dev-foot / 2026-07-20 · ticket: T-20260720-foot-AICC-ANON-PII-LEAK (AC2)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE ALL PRIVILEGES ON public.aicc_crm_phone_match FROM anon;

COMMIT;
