-- ============================================================================
-- T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE
--   (y) keep-widen — visit_route CHECK allowlist ADD  ★SCAFFOLD (미적용·NOT-FOR-APPLY)★
--   author: dev-foot / 2026-08-19  (prep item #2, planner FOLLOWUP-6 reply MSG-20260819-162925-bguj)
-- ============================================================================
--
-- ⚠⚠⚠ 이 파일은 SCAFFOLD 이다 — 적용 금지. supabase/migrations/ 밖(db-gate/)에 의도적으로 둔다.
--   최종 적용 전제(3중 게이트, 전부 선행 REQUIRED):
--     (1) F1 (revisit clobber) 해소 — 김주연 총괄 confirm (재방문 옵션 노출 여부 = 아래 allowlist 확정)
--     (2) DA bless — 완료 (MSG-20260819-163315-f5ey: ADDITIVE·firewall-neutral CONFIRM, MIG-GATE/GO-token NOT 면제)
--     (3) supervisor MIG-GATE(2-table DDL-diff) + 물리 GO-token (apply_before_go 금지·apply-gate=supervisor NOT DA)
--   위 3중 게이트 통과 후: 최종 라벨 확정 → PLACEHOLDER 치환 → supabase/migrations/<ts>_...sql 로 이관 → 적용.
--
-- ── mirror-not-invent (F3-b, planner 지시) ──
--   store-format = 한글 라벨 (prod 실측 2026-08-19: 두 테이블 byte-identical 7값).
--   근거 evidence: scripts/T-20260818-...storeformat_introspect.mjs 실행결과
--     customers/reservations = 'TM','워크인','인바운드','지인소개','네이버','인콜','공홈' (동형·정합).
--   → 신규 값도 반드시 한글 라벨로 저장(canonical dot-code[partner.agency 등]은 vocabulary 식별자이지 store 값 아님).
--
-- ── ADDITIVE (§3.1 대표 파괴게이트 면제 근거·but MIG-GATE/GO-token NOT 면제) ──
--   · 기존 7값 전부 존치(byte-parity). DROP 값 0. 타입변경 0. 기존행 UPDATE 0. backfill 0.
--   · DROP CONSTRAINT IF EXISTS + ADD superset (공홈 선례 20260716160000 동형·멱등).
--   · 2-table co-deploy 원자성(DA census item): customers ∧ reservations 를 동일 widened set 으로 동시 갱신
--     (1개만 widen 시 write fail·divergence) + FE 드롭다운(VISIT_ROUTE_OPTIONS) co-deploy.
--   · firewall-neutral(§36 3직교축 접촉 0): visit_route 저장문자열 = foot-local capture 축 vocabulary 확장.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- FAIL-CLOSED SENTINEL — placeholder 미해소 상태로 실행 시 abort (사고 방지)
--   최종화 시: 아래 __SCAFFOLD_PLACEHOLDER__ 상수를 'RESOLVED' 로 바꾸고 신규 라벨 확정.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF 'PENDING' = 'PENDING' THEN  -- __SCAFFOLD_PLACEHOLDER__ (최종화 시 'RESOLVED' 로 치환)
    RAISE EXCEPTION 'SCAFFOLD 미해소: F1(revisit)·최종 allowlist·GO-token 확정 전 적용 금지. db-gate/*.SCAFFOLD.sql 은 적용 대상 아님.';
  END IF;
END $$;

BEGIN;

-- ── 신규 값 목록 (★PLACEHOLDER — F1 해소 + planner AC 확정 후 치환★) ──
--   [확정 SEPARATE 4항목] (comp-gate RESOLVED 2026-08-19, store 라벨=candidate·최종 wording=planner/reporter 확정):
--     '에이전시'          -- partner.agency        (해외환자 유치 에이전시)
--     '타센터 연계'        -- internal.center_referral
--     '병원 인계'          -- internal.transfer
--     '임직원·가족'        -- internal.staff
--   [F1-PENDING — 노출/저장 여부 미확정] :
--     '기존 고객 재방문'    -- inbound.revisit  ← ★F1: 노출 시 원 획득경로 clobber 위험 → 김주연 총괄 confirm 대기
--   [DA enum-gate PENDING — 별 게이트] :
--     '인바운드(카톡)'      -- inbound.kakao    ← 부모 umbrella note 11:54, DA CONSULT 대기(canonical ADD)
--
--   ⇒ 최종 widened allowlist = 기존 7 (byte-parity) + 확정 신규 N (F1 결과에 따라 revisit 포함/제외).
--      아래 ARRAY 는 기존 7값만 실재(byte-parity), 신규는 PLACEHOLDER 주석으로만 표기(미커밋).

-- 1) customers.visit_route  ── 동시 widen 대상 ①
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_visit_route_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN (
    -- 기존 7 (prod byte-parity · 존치) --
    'TM','워크인','인바운드','지인소개','네이버','인콜','공홈'
    -- ,'에이전시','타센터 연계','병원 인계','임직원·가족'   -- ★신규 SEPARATE 4 (최종화 시 해제)
    -- ,'기존 고객 재방문'                                 -- ★F1 확정 시에만
    -- ,'인바운드(카톡)'                                   -- ★DA enum-gate 통과 시에만
  ));

-- 2) reservations.visit_route  ── 동시 widen 대상 ② (①과 반드시 동일 set)
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_visit_route_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_visit_route_check
  CHECK (visit_route IS NULL OR visit_route IN (
    -- 기존 7 (prod byte-parity · 존치) --
    'TM','워크인','인바운드','지인소개','네이버','인콜','공홈'
    -- ,'에이전시','타센터 연계','병원 인계','임직원·가족'   -- ★신규 SEPARATE 4 (최종화 시 해제)
    -- ,'기존 고객 재방문'                                 -- ★F1 확정 시에만
    -- ,'인바운드(카톡)'                                   -- ★DA enum-gate 통과 시에만
  ));

-- ── 검증 (2-table 동시 widen 정합 + 신규값 포함 확인 — 최종화 시 신규 라벨로 갱신) ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'customers_visit_route_check'
       AND pg_get_constraintdef(oid) LIKE '%공홈%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reservations_visit_route_check'
       AND pg_get_constraintdef(oid) LIKE '%공홈%'
  ) THEN
    RAISE EXCEPTION '2-table visit_route CHECK widen 정합 실패(byte-parity 존치 확인 실패)';
  END IF;
END $$;

COMMIT;

-- ── 롤백 = 직전 7값 복원 (신규값 저장행 존재 시 선행 정리 필요 — 최종화 시 rollback 파일 별첨) ──
-- ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_visit_route_check;
-- ALTER TABLE public.customers ADD CONSTRAINT customers_visit_route_check
--   CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개','네이버','인콜','공홈'));
-- ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_visit_route_check;
-- ALTER TABLE public.reservations ADD CONSTRAINT reservations_visit_route_check
--   CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개','네이버','인콜','공홈'));
