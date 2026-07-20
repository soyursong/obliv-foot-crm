-- T-20260720-foot-AICC-ANON-PII-LEAK · AC3 (베이스 봉합 1/2 — SECDEF RPC 신설) · UP
-- ════════════════════════════════════════════════════════════════════════════
-- SEV-1 LIVE PHI 읽기 누출 봉합 (2/3) — customers anon 직접 SELECT 를 대체할 SECDEF RPC.
--
-- DA 옵션 ②(SECDEF 이관) 확정 (planner MSG-20260720-222643-gg5l).
--   근본원인 = customers anon SELECT grant + 정책 anon_select_customer_self_checkin
--     (USING clinic_id IS NOT NULL = 전 clinic 광범) → anon 이 .select('name,phone') 크래프팅으로
--     504/504 전량 exfil (RLS=행통제·컬럼불가). predicate-tightening 은 reach-0 불가 → 채택 안 함.
--   reach-0 유일경로 = anon SELECT 완전 제거 + L1760 을 SECDEF RPC 로 이관.
--
-- load-bearing 경로 = foot-checkin SelfCheckIn.tsx L1760 (정확히 1곳, AC1 CONSULT):
--   검증된 예약(phone-gated RPC 통과)인데 예약행에 customer_id 결측인 상류갭 edge fallback.
--   phone→기존 customer_id 해소(link, INSERT 아님). 반환=id 단독(name/phone 미투영).
--   → 본 RPC 가 동일 시맨틱을 id-only·clinic-scoped·SECDEF 로 대체. 정당 셀프체크인 보존(회귀0).
--
-- 시맨틱 = 기존 FE 쿼리 verbatim 미러 (회귀0 목적):
--   SELECT id FROM customers WHERE clinic_id=? AND phone = ANY(candidates) ORDER BY created_at ASC LIMIT 1
--   ※ 기존 .in('phone', phoneCandidates) = phone 정확일치(candidates 배열은 FE 가 stored/E164/digits/formatted
--     4형태로 이미 확장) → RPC 도 정확일치(canonical 정규화 미도입, 동작 불변 유지).
--
-- 보안: SECURITY DEFINER(owner=postgres) → anon RLS/grant 우회하되 id-only 반환·clinic_id 스코프 강제
--   → cross-clinic 누출 없음. name/phone 절대 반환 안 함. search_path 고정(injection 차단).
--
-- ★ 신규 함수만 — 신규 컬럼/테이블/enum/시그니처변경 0 = ADDITIVE. §S2.4 DA CONSULT 게이트 비해당
--   (DA 결정문이 SECDEF 이관을 remediation 으로 명시). CEO 게이트 불요.
-- 멱등: CREATE OR REPLACE + GRANT = 자연 멱등.
-- 롤백: 20260720231000_foot_selfcheckin_resolve_custid_rpc.rollback.sql (DROP FUNCTION).
-- 게이트: owner=postgres → supervisor DDL-diff DB-GATE + MIG-GATE 4필드.
-- ⚠ 배포순서: 본 RPC(additive) → foot-checkin FE 컷오버 → customers anon SELECT lockdown(3/3, 별도 마이그).
-- author: dev-foot / 2026-07-20 · ticket: T-20260720-foot-AICC-ANON-PII-LEAK (AC3)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_resolve_customer_id_by_phone(
  p_clinic_id        uuid,
  p_phone_candidates text[]
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id
  FROM public.customers c
  WHERE c.clinic_id = p_clinic_id
    AND c.phone = ANY(p_phone_candidates)
  ORDER BY c.created_at ASC NULLS LAST
  LIMIT 1;
$$;

-- anon(키오스크 비로그인) + authenticated 실행 허용. PUBLIC 광범 실행은 부여 안 함.
REVOKE ALL ON FUNCTION public.fn_selfcheckin_resolve_customer_id_by_phone(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_resolve_customer_id_by_phone(uuid, text[])
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_resolve_customer_id_by_phone(uuid, text[]) IS
  'T-20260720-foot-AICC-ANON-PII-LEAK: 셀프체크인 검증예약 상류갭 fallback — clinic-scoped phone→customer_id 해소(id-only). '
  'customers anon 직접 SELECT(정책 anon_select_customer_self_checkin) 대체용 SECDEF RPC. name/phone 절대 미반환.';

COMMIT;
