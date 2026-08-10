-- T-20260810-foot-TESTACCT-CLEANUP-8ACCT  Leg B 2차 배치 — is_test flag 2건 (물리삭제 NO-GO·의료법 보존)
-- planner NEW-TASK MSG-20260811-082849-425f · DA GO: DA-20260810-foot-TESTACCT-ISTEST-ADDITIVE-PARITY (조건부 GO).
--
-- 대상 2 customers (Leg B 2차): 풋테스트1 F-4427 · 박민석 F-4445
--   ▸ F-4427(e72022d0) = printed form_submission·doc_serial_seq=74 발번 발행문서 → 의료법 §22/§40 보존
--     → 물리삭제 HARD REJECT → is_test view-hide(원장보존).
--   ▸ F-4445(66c08e48) = 진료의뢰서1(발행서류 후보)·payments 상쇄쌍(₩3000 pay+refund net0) → 물리삭제 NO-GO → is_test view-hide.
--   ★★★ F-4445 = 박민석 본계정(F-4790 / 1c61bad2) 아님 = 동명이인 별건(4jg4 확정). ★본계정 flag 절대 금지.
--
-- 인프라(Leg B 1차): customers.is_test 컬럼 + v_daily_revenue 이중제외 = 旣 APPLIED(2026-08-11 01:08·POSTCHECK 5/5 PASS).
--   본 마이그 = per-row flag UPDATE 2건만 추가(신규 DDL 0·컬럼/뷰 무접촉). id whitelist 명시(blanket UPDATE 금지·Backfill SOP).
-- 성격: 비파괴 flag UPDATE(ADDITIVE·행 물리 mutation 0·매출집계는 v_daily_revenue is_test 필터로 자동 제외).
-- 멱등: `is_test IS DISTINCT FROM true` 조건 → 재실행 시 0-row no-op(no-drift). 최초 apply rows-affected = 2.
-- rollback: 20260811060000_foot_testacct8_legB_istest_flag_2row.rollback.sql (2건 false 원복·1차 3계정 무접촉).
-- ★apply = supervisor DB-GATE(freeze-set 2행 whitelist + rows-affected=2 + silent 0-row 금지 + GO-token) 後만.
--   ★ GO-token 前 prod flag UPDATE 선집행 금지(apply_before_go 클래스).

BEGIN;

-- ═══ per-row flag UPDATE (id whitelist·blanket 금지·멱등) ═══
UPDATE public.customers SET is_test = true
 WHERE id IN ('e72022d0-7cf5-4f42-b5e3-b5162005b454'::uuid,   -- F-4427 풋테스트1 (printed serial 74)
              '66c08e48-c708-4e50-963d-aaa56b27d9ea'::uuid)   -- F-4445 박민석(동명이인 별건·본계정 아님)
   AND is_test IS DISTINCT FROM true;  -- expect rows-affected = 2 (최초) · 0 (재실행)

-- ═══ IN-TXN SELF-TEST (freeze-set·본계정 오flag 차단·over-flag 차단) ═══
DO $$
DECLARE n_target int; n_total int; missing text;
BEGIN
  -- (1) 대상 2건 flag 확증
  SELECT count(*) INTO n_target FROM public.customers
    WHERE id IN ('e72022d0-7cf5-4f42-b5e3-b5162005b454'::uuid,'66c08e48-c708-4e50-963d-aaa56b27d9ea'::uuid) AND is_test = true;
  IF n_target <> 2 THEN RAISE EXCEPTION 'legB is_test target flag expected 2, got %', n_target; END IF;
  -- (2) ★ 박민석 본계정 F-4790(1c61bad2) 절대 미flag
  IF EXISTS (SELECT 1 FROM public.customers WHERE id = '1c61bad2-ad49-4e7d-92ae-2d132aae95cb'::uuid AND is_test = true)
  THEN RAISE EXCEPTION 'legB: 박민석 본계정 F-4790 must NOT be is_test (F-4445 별건만 flag)'; END IF;
  -- (3) over-flag 차단: is_test=true 전체 = 정확히 {F-4427,F-4445,F-4574,F-4990,F-5113} 5건(1차 3 + 2차 2)
  SELECT count(*) INTO n_total FROM public.customers WHERE is_test = true;
  IF n_total <> 5 THEN RAISE EXCEPTION 'legB: is_test=true total expected 5, got % (over/under-flag)', n_total; END IF;
  SELECT string_agg(x,',') INTO missing FROM (
    SELECT unnest(ARRAY['F-4427','F-4445','F-4574','F-4990','F-5113']) AS x
    EXCEPT SELECT chart_number FROM public.customers WHERE is_test = true) s;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'legB: expected flagged chart_number missing: %', missing; END IF;
END $$;

COMMIT;
-- exact-N POSTCHECK (apply 후): is_test=true = 5건(F-4427,F-4445,F-4574,F-4990,F-5113) / 본계정 F-4790 is_test=false /
--   v_daily_revenue 매출집계에서 5계정 자동 제외 / 행 물리 mutation 0.
