-- ════════════════════════════════════════════════════════════════════════════
-- Migration: 20260812080000_foot_testacct8_legB2_istest_flag_2acct
-- Ticket:  T-20260810-foot-TESTACCT-CLEANUP-8ACCT  (Leg B 2차 — is_test flag 추가 2건)
-- DA SSOT: da_decision_foot_testacct_istest_additive_parity_20260810.md
--          da_consult_ref = DA-20260810-foot-TESTACCT-ISTEST-ADDITIVE-PARITY (조건부 GO)
--          + a0cj/z676 (Path-B RETRACT·처분 UNCHANGED) + 총괄 '완전정리' confirm(1786403792.800929)
-- change-class: ADDITIVE — flag UPDATE only (is_test 컬럼은 Leg B infra 로 旣존재/applied 01:08).
--   DDL 없음(ADD COLUMN IF NOT EXISTS = 멱등 no-op guard). → supervisor DB-GATE
--   (flag UPDATE freeze-set + rows-affected=2 검증 + GO-token) 만. apply_before_go 절대금지.
--
-- ⚠⚠ SEMANTIC FIREWALL (DA H1 — BINDING) ⚠⚠  is_test ⊥ is_simulation. co-set/overload 금지.
--
-- ── 처분 근거 (Leg B 2차 = 물리삭제 HARD REJECT → is_test view-hide 착지) ──
--   • F-4427 풋테스트1  = printed·doc_serial_seq=74 발번문서 → 의료법 §22/§40 보존 → 물리삭제 HARD REJECT.
--   • F-4445 박민석(별건) = 진료의뢰서1(발행서류) + 상쇄결제(net0) → 물리삭제 NO-GO.
--     ★박민석 본계정(F-4790, 1c61bad2-…) = 버그확인용 KEEP → 본 whitelist 미포함(동명이인 4jg4 확정).
--
-- flag 대상 (DA H3 — 명시 id whitelist per-row, single-criterion blanket UPDATE 금지):
--   census(census_2acct.mjs, 2026-08-12 foot prod, NFC exact·유일성 확인):
--     F-4427 풋테스트1     = e72022d0-7cf5-4f42-b5e3-b5162005b454  (is_test=false 확인)
--     F-4445 박민석(별건)  = 66c08e48-c708-4e50-963d-aaa56b27d9ea  (is_test=false 확인·동명이인)
--   ★ KEEP GUARD (whitelist 미포함, 절대 flag 금지):
--     F-4790 박민석 본계정 = 1c61bad2-ad49-4e7d-92ae-2d132aae95cb  (버그확인용 유지)
--
-- landmine guard (DA H4): flag-only. 어떤 행도 삭제하지 않음. flag↔delete collapse 금지.
-- 멱등: ADD COLUMN IF NOT EXISTS(no-op) · flag UPDATE 재실행 시 동일 2행(no drift).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- A. is_test 컬럼 존재 보장 (Leg B infra 旣 applied. IF NOT EXISTS = 멱등 no-op·replay-safe self-contained)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_test boolean DEFAULT false;

-- B. flag backfill — 명시 id whitelist per-row (DA H3). freeze-set = 아래 2 uuid. rows-affected=2 검증.
UPDATE public.customers
   SET is_test = true
 WHERE id IN (
   'e72022d0-7cf5-4f42-b5e3-b5162005b454'::uuid,  -- F-4427 풋테스트1 (printed serial74 → 보존·view-hide)
   '66c08e48-c708-4e50-963d-aaa56b27d9ea'::uuid   -- F-4445 박민석(별건 동명이인 → 보존·view-hide)
 );

-- C. rows-affected 자기검증 (freeze-set 정확히 2행 + KEEP 본계정 미오염 확인)
DO $$
DECLARE flagged_target int; flagged_keep int;
BEGIN
  SELECT count(*) INTO flagged_target FROM public.customers
   WHERE is_test = true
     AND id IN ('e72022d0-7cf5-4f42-b5e3-b5162005b454'::uuid,
                '66c08e48-c708-4e50-963d-aaa56b27d9ea'::uuid);
  IF flagged_target <> 2 THEN
    RAISE EXCEPTION 'ABORT: legB2 freeze-set expected 2 flagged, got %', flagged_target;
  END IF;
  -- KEEP guard: 박민석 본계정은 절대 flag 되면 안 됨
  SELECT count(*) INTO flagged_keep FROM public.customers
   WHERE is_test = true AND id = '1c61bad2-ad49-4e7d-92ae-2d132aae95cb'::uuid;
  IF flagged_keep <> 0 THEN
    RAISE EXCEPTION 'ABORT: KEEP guard violated — 박민석 본계정(F-4790) flagged is_test';
  END IF;
END $$;

COMMIT;
