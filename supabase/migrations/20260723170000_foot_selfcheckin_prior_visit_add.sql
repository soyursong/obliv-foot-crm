-- T-20260723-foot-JONGNO-KIOSK-READPATH-ANON-CUTOVER — 착수조건 ① (ADDITIVE / ZERO-REGRESSION)
-- 표준: cross_crm_data_contract.md §16-3 (anon 직접 SELECT → SECURITY DEFINER RPC 대체) · §15-5-1 CLASS①
-- DA 결정: da_decision_foot_jongno_kiosk_readpath_anon_cutover_20260723.md (GO · ADDITIVE · 대표게이트 면제 §3.1+§15-5-7)
--
-- ════════════════════════════════════════════════════════════════════════════
-- 본건 = Phase 2a SECDEF RPC(20260615170000, 이미 prod) 라인의 net-new 1종 추가.
--   · 대체 대상: foot-checkin SelfCheckIn.tsx L1589 재진판정 = anon 직접 check_ins SELECT.
--   · 판정 = 검증된 customer_id 의 과거(오늘 이전) 방문이력(check_in) 존재 여부(boolean).
--   · zero-PII: id/PHI 미반환, boolean 단일 반환 → enumeration 위험 0.
--   · ADDITIVE: 기존 anon SELECT 정책 미변경 → 셀프체크인 회귀 0. (파괴적 DROP/REVOKE 는 부모 2b 소유.)
--
-- ── RETURNS boolean 판정 근거 (DA 주의 "UI 마지막 방문일 표시 필요시 RETURNS date 조정" 검토) ──
--   FE(SelfCheckIn.tsx) 는 재진배너에 '마지막 방문일'을 렌더하지 않음(isKnownReturning boolean 만 소비,
--   재진/초진 라벨 + 배너 시간/성함은 별도 소스). → boolean 충분, date 불요. (dev-foot 확인 완료.)
--
-- ── 술어 (DA 명시) ──
--   clinic 스코프 AND status <> 'cancelled' AND created_at(KST)::date < today(KST)
--   (FE L1595 `.lt('created_at', `${todayKst}T00:00:00+09:00`)` 와 의미 동치.)
--   입력 = customer_id (fn_selfcheckin_find_customer/match_reservation 로 이미 해소, phone 재전달 불요).
--          p_customer_id IS NULL(신규) → EXISTS 자연 false. (FE 는 신규 시 호출 skip.)
--
-- ── §15-5-1 CLASS① 자동편입 (fn_selfcheckin_*) ──
--   REVOKE EXECUTE FROM PUBLIC (blanket exec 상속 차단) + GRANT anon,authenticated (키오스크 경로 개방).
--   SECURITY DEFINER + SET search_path = public, pg_temp (Q3 하이재킹 차단, 20260615170000 정합).
--   owner = 마이그 실행 role(postgres) → A7(권한상승) 무발동.
--
-- 롤백 = DROP FUNCTION (20260723170000_..._add.rollback.sql). 회귀 0.
-- author: dev-foot / 2026-07-23
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── [읽기 대체] 재진 판정 (customer_id → 오늘 이전 방문이력 존재 여부, cancelled 제외) ──
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_prior_visit(
  p_clinic_id   UUID,
  p_customer_id UUID
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_customer_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM check_ins ci
     WHERE ci.clinic_id   = p_clinic_id
       AND ci.customer_id = p_customer_id
       AND ci.status <> 'cancelled'
       AND (ci.created_at AT TIME ZONE 'Asia/Seoul')::date
             < (now() AT TIME ZONE 'Asia/Seoul')::date
  )
$$;

-- EXECUTE: anon 키오스크 경로 + authenticated. (§15-5-1 CLASS① — REVOKE PUBLIC + GRANT anon 동봉)
REVOKE EXECUTE ON FUNCTION public.fn_selfcheckin_prior_visit(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_selfcheckin_prior_visit(UUID, UUID) TO anon, authenticated;

COMMIT;
