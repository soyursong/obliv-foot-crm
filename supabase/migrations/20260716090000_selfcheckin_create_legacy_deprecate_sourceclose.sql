-- T-20260715-foot-SELFCHECKIN-LEGACYCREATE-SOURCECLOSE-HEAL — Phase A (소스차단 先)
-- Parent: XCRM-SWEEP DA fold-judge(MSG-20260715-092735-x1si) 파생 A3(divergent 정정) / meta T-20260715-CHECKIN-WRITE-IDENTITY-XCRM-SWEEP
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 목적 — 레거시 self_checkin_create(text,text,text) 미링크 divergence 벡터 봉합
-- ══════════════════════════════════════════════════════════════════════════════
-- DA 판정(foot=CLEAN): 라이브 self-checkin 경로 = self_checkin_with_reservation_link (reservation_id 링크
--   + AFTER INSERT 트리거 trg_checkin_sync_reservation 원자 전이). 5 CRM 중 유일하게 ② 완결.
-- 잔여 벡터: 레거시 self_checkin_create(text,text,text) = reservation_id 를 전혀 세팅하지 않는 INSERT
--   → AFTER INSERT 트리거 fn_checkin_sync_reservation() 의 `IF NEW.reservation_id IS NOT NULL` 미발화
--   → 링크 안 된 check_in 생성 가능 벡터(예약 confirmed 잔존). = INV-1/미링크 divergence 소스.
--
-- 소스차단 근거 (prod 실측, probeA 2026-07-16):
--   · proacl = {postgres=X, anon=X, authenticated=X, service_role=X}  ← anon/auth/service 모두 EXECUTE 잔존(열린 표면).
--     (allowlist 20260710223000 이 PUBLIC 은 회수했으나 anon 명시 grant 는 이 함수에 잔존 → 실측으로 확정.)
--   · 잔여 호출처 = 0 (확정):
--       - obliv-foot-crm/src grep       → 0
--       - foot-checkin(soyursong)/src   → 0 (라이브 셀프체크인 앱은 self_checkin_with_reservation_link 만 호출)
--       - 양 repo supabase/functions    → 0
--       - prod pg_proc 내부 체이닝       → 0 (다른 함수 본문이 self_checkin_create 호출 안 함)
--   → 완전 dead code + 열린 anon 표면. deprecate(EXECUTE 회수)로 소스 봉합.
--
-- 방식 선택 = deprecate(REVOKE) — 함수 본문 ALTER 아님:
--   · DA fold-judge = "ALTER 제외·과적용 금지". 본 마이그는 함수 본문(CREATE OR REPLACE) 무변경.
--   · 오직 EXECUTE grant 회수(권한 메타 proacl) + deprecated 주석. → "RPC ALTER 시 DA CONSULT" 게이트 미해당.
--   · 비파괴(함수 DROP 안 함 → 감사/롤백 보존) · 가역(rollback = 재-GRANT).
--   · postgres(owner)=X 유지 → definer 컨텍스트/내부 체이닝(현재 0건) 무영향.
--
-- 멱등: REVOKE 는 자연 멱등(반복 무해). COMMENT 도 멱등.
-- 데이터 무변경(권한 메타 + 주석만). 가역(rollback SQL 동봉).
-- 적용: ★ supervisor DDL-diff 게이트(proacl before/after 대조 + 잔여 호출처 0 재확인) 후에만.
-- Rollback: 20260716090000_selfcheckin_create_legacy_deprecate_sourceclose.rollback.sql
-- 소스닫힘 증거: 배포 후 probeA 재실행 → anon_exec/authenticated_exec/service_role_exec = false,
--               신규 unlinked+당일confirmed 유입 0 지속(P4).

BEGIN;

-- 1) EXECUTE 회수 — PUBLIC(안전망) + 명시 3 role. anon 은 PUBLIC 멤버지만 명시 grant 보유 → 둘 다 회수.
REVOKE EXECUTE ON FUNCTION public.self_checkin_create(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- 2) deprecated 마킹 (본문·시그니처 무변경, 감사 추적용)
COMMENT ON FUNCTION public.self_checkin_create(text, text, text) IS
  'DEPRECATED 2026-07-16 (T-20260715-foot-SELFCHECKIN-LEGACYCREATE-SOURCECLOSE-HEAL). '
  'reservation_id 미링크 INSERT → sync 트리거 미발화 divergence 벡터. 호출처 0 확정, EXECUTE 전면 회수. '
  '라이브 셀프체크인 = self_checkin_with_reservation_link(uuid,jsonb,date) 사용. 본 함수 신규 호출 금지.';

COMMIT;
