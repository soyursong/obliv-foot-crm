-- ════════════════════════════════════════════════════════════════════════════
-- T-20260724-foot-ASSIGN-UPSYNC-REVENUE-REATTRIB-GATE
-- baseline-freeze 백필 — 레거시 결제행 attributed_staff_id 초기 스냅샷 — Data-Correction Backfill SOP 봉투
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 무엇 (report-neutral 백필)
-- ─────────────────────────────────────────────────────────────────────────────
--   DDL 마이그(20260814160000) 적용 후, 기존(레거시) 결제행의 attributed_staff_id 를 현재
--   customers.assigned_staff_id(live-join 산출값)로 못박는다(baseline-freeze).
--   · ★report-neutral: freeze값 == 현 live-join 산출값 → 현 리포트 숫자 이동 0(재분배 없음).
--     read 는 COALESCE(attributed_staff_id, live-join) 이므로 백필 前/後 동일 숫자 — 백필은 "미래
--     재배정에 대해 과거 귀속을 못박기 위한" 물질화일 뿐(값-synthesis 아님·결정적 read).
--   · gate③(대표 comp) 불발동 정합 = 소급 재분배 0.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Data-Correction Backfill SOP 준수 (data_correction_backfill_sop)
-- ─────────────────────────────────────────────────────────────────────────────
--   §0-2 소스차단 선행: DDL 마이그의 BEFORE INSERT 트리거가 forward 각인 활성 = 신규행은 이미 stamp.
--     따라서 본 백필 대상 = 트리거 활성 前 레거시행(attributed_staff_id IS NULL)뿐 = forward-seal 후 소급.
--   §1 단일 count 금지 → 대상셋 술어 확정(NULL AND 고객 assigned_staff 존재)로 freeze, count 근거 스냅샷.
--   §2-S-3 컬럼완전성 → attributed_staff_id 만 write(단일 컬럼).
--   §3 rows==expected abort → DO 블록에서 예상건수 선계산 후 GET DIAGNOSTICS 대조, 불일치 시 RAISE(롤백).
--   §4 원장 무접점 → amount/insurance_covered_amount/tax_type/payment_type/총합/split 절대 무접점.
--   멱등 → attributed_staff_id IS NULL 만 갱신(재실행 시 0건).
--
-- change_class = ADDITIVE(레거시 NULL 채움 · 기존 비-NULL 무변경 · 금액컬럼 무접점 · DROP 0).
--   ⚠️ DDL 마이그(20260814160000) 적용 + 트리거 활성 이후에만 실행(순서 의존). supervisor 물리
--      GO-token 후 apply. 게이트순서(DA 명시): apply(DDL) → backfill(본 파일·SOP) → POSTCHECK.
--
-- dry-run  : 20260814160100_foot_attributed_staff_baseline_freeze.dryrun.mjs (No-Persistence + 대조)
-- rollback : 20260814160100_foot_attributed_staff_baseline_freeze.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

-- payments — baseline-freeze (rows==expected abort 가드)
DO $$
DECLARE
  v_expected BIGINT;
  v_actual   BIGINT;
BEGIN
  -- 대상셋 freeze: NULL 스냅샷 AND 고객이 현재 담당(assigned_staff_id) 보유.
  SELECT count(*) INTO v_expected
  FROM public.payments p
  JOIN public.customers c ON c.id = p.customer_id
  WHERE p.attributed_staff_id IS NULL
    AND c.assigned_staff_id IS NOT NULL;

  UPDATE public.payments p
  SET attributed_staff_id = c.assigned_staff_id
  FROM public.customers c
  WHERE p.customer_id = c.id
    AND p.attributed_staff_id IS NULL
    AND c.assigned_staff_id IS NOT NULL;

  GET DIAGNOSTICS v_actual = ROW_COUNT;
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION 'BACKFILL_ABORT payments: rows_affected(%) <> expected(%) — 대상셋 drift, 롤백', v_actual, v_expected;
  END IF;
  RAISE NOTICE 'baseline-freeze payments: % 행 스냅샷(report-neutral)', v_actual;
END $$;

-- package_payments — baseline-freeze (rows==expected abort 가드)
DO $$
DECLARE
  v_expected BIGINT;
  v_actual   BIGINT;
BEGIN
  SELECT count(*) INTO v_expected
  FROM public.package_payments p
  JOIN public.customers c ON c.id = p.customer_id
  WHERE p.attributed_staff_id IS NULL
    AND c.assigned_staff_id IS NOT NULL;

  UPDATE public.package_payments p
  SET attributed_staff_id = c.assigned_staff_id
  FROM public.customers c
  WHERE p.customer_id = c.id
    AND p.attributed_staff_id IS NULL
    AND c.assigned_staff_id IS NOT NULL;

  GET DIAGNOSTICS v_actual = ROW_COUNT;
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION 'BACKFILL_ABORT package_payments: rows_affected(%) <> expected(%) — 대상셋 drift, 롤백', v_actual, v_expected;
  END IF;
  RAISE NOTICE 'baseline-freeze package_payments: % 행 스냅샷(report-neutral)', v_actual;
END $$;
