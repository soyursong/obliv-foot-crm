-- T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK — CARVE-A: closing_insurance_split G2 voided_at parity
-- DA REPLY MSG-20260814-000358-6osg (Q1 G2: 공단부담액 recompute `voided_at IS NULL` N-axis parity·전 site byte-identical)
--   · dev-foot dispatch MSG-20260814-001939-vc7k
--
-- 목적: service_charges.voided_at(CARVE-A 20260814000000 신설) soft-void 도입에 따른 서버측 G2 parity.
--   closing_insurance_split(마감 전령 급여구분축 recompute)이 service_charges 를 2곳에서 집계 →
--   soft-void 라인이 급여 copay/공단부담 산식에 계속 반영되면 FE live-recompute(voided_at IS NULL 필터)와 divergence.
--   → 두 service_charges 술어에 `AND sc.voided_at IS NULL` 추가(byte-identical parity).
--
-- ★불변식 무영향(INV2/INV3): 본 함수의 `total`(v_sys_total)=daily_closings payment-grain 확정 구성분 →
--   service_charges void 는 total 무접촉(INV5 3중대조 안전). void 는 rev_copay_self(copay EXISTS)·
--   rev_insurance_covered(공단부담 SUM) split 만 조정 → FE(SalesDailyTab)와 정합.
--   배포 직후 전건 voided_at=NULL → recompute 결과 불변(net-zero).
--
-- change-class = 함수 재정의(CREATE OR REPLACE·시그니처 불변·DROP 불요·즉시 역전). 테이블/data/스키마 변경 0.
--   money-path 함수(급여구분 VAT invariant oracle) → supervisor MIG-GATE(DDL-diff+code-gate) + 물리 GO-token 선행.
--   ★원자배포 계약: 20260814000000(voided_at 컬럼 ADD) 반드시 선행/동시(컬럼 부재 시 `sc.voided_at` 참조 오류).
--
-- ★C23-4 grant-seal: CREATE OR REPLACE 는 Supabase public default privileges 재부여 위험 →
--   하단 per-fn REVOKE PUBLIC/anon/authenticated + GRANT service_role 재봉인(20260806150000 §Y 패턴 미러).
BEGIN;

CREATE OR REPLACE FUNCTION public.closing_insurance_split(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sys_total BIGINT;
  v_copay_raw BIGINT;
  v_copay     BIGINT;
  v_nonins    BIGINT;
  v_covered   BIGINT;
BEGIN
  -- ── 권위 총액 = daily_closings 확정 구성분 (AC1·source_split 동일 유니버스) ──
  SELECT COALESCE(dc.package_card_total,0)     + COALESCE(dc.single_card_total,0)
       + COALESCE(dc.package_cash_total,0)     + COALESCE(dc.single_cash_total,0)
       + COALESCE(dc.package_transfer_total,0) + COALESCE(dc.single_transfer_total,0)
    INTO v_sys_total
    FROM public.daily_closings dc
   WHERE dc.clinic_id = p_clinic AND dc.close_date = p_date
   ORDER BY dc.revision DESC
   LIMIT 1;
  v_sys_total := COALESCE(v_sys_total, 0);

  -- ── 급여 본인부담(copay) = 단건 payments(card/cash/transfer) 중 급여청구(service_charges) 존재분. created_at KST ──
  --    패키지 = 전건 비급여(DA Q3-2) → copay 미가산(패키지분은 nonins 흡수).
  SELECT COALESCE(SUM(CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END), 0)
    INTO v_copay_raw
    FROM public.payments p
    LEFT JOIN public.check_ins ci ON ci.id = p.check_in_id
   WHERE COALESCE(p.clinic_id, ci.clinic_id) = p_clinic
     AND p.is_simulation IS NOT TRUE
     AND p.status IS DISTINCT FROM 'deleted'
     AND p.method IN ('card','cash','transfer')
     AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date = p_date
     AND EXISTS (
       SELECT 1 FROM public.service_charges sc
       WHERE sc.check_in_id = p.check_in_id
         AND sc.is_insurance_covered = true
         AND sc.is_simulation IS NOT TRUE
         AND sc.voided_at IS NULL);   -- CARVE-A G2 parity: soft-void 라인 제외

  -- ── residual 흡수: noninsurance = sys_total − copay(패키지 전건 흡수). 클램프(INV4) → INV2 항등 보장 ──
  v_copay  := GREATEST(0, LEAST(COALESCE(v_copay_raw, 0), GREATEST(v_sys_total, 0)));
  v_nonins := v_sys_total - v_copay;

  -- ── 공단부담(rev_insurance_covered): 명세 grain, total 밖·INV3(>=0). 패키지 무기여(비급여). 170000 산식 유지 ──
  SELECT COALESCE(SUM(sc.insurance_covered_amount), 0)
    INTO v_covered
    FROM public.service_charges sc
    LEFT JOIN public.check_ins ci ON ci.id = sc.check_in_id
   WHERE COALESCE(sc.clinic_id, ci.clinic_id) = p_clinic
     AND sc.is_simulation IS NOT TRUE
     AND sc.is_insurance_covered = true
     AND sc.voided_at IS NULL       -- CARVE-A G2 parity: soft-void 라인 제외
     AND COALESCE(ci.checked_in_at::date, sc.calculated_at::date) = p_date;

  RETURN jsonb_build_object(
    'rev_copay_self',        v_copay,
    'rev_noninsurance',      v_nonins,
    'rev_insurance_covered', COALESCE(v_covered, 0),
    'total',                 v_sys_total
  );
END;
$$;

COMMENT ON FUNCTION public.closing_insurance_split(UUID, DATE) IS
  'T-CLOSING-HERALD(foot) v1.8 CARVE-A VOIDED-PARITY: 급여구분축. total=daily_closings 확정 구성분 authority. '
  'rev_copay_self=단건 급여청구분(service_charges covered·voided_at IS NULL)·rev_noninsurance=total−copay(패키지 전건 비급여 흡수 DA Q3-2). '
  'copay+nonins==total(INV2). rev_insurance_covered=공단부담(명세 grain·total 밖·>=0·INV3 독립·voided_at IS NULL). ledger net 폐기.';

-- ── §Y per-fn grant-seal (C23-4: CREATE OR REPLACE default-privilege 재부여 방어) ──
REVOKE EXECUTE ON FUNCTION public.closing_insurance_split(UUID, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.closing_insurance_split(UUID, DATE) FROM anon;
REVOKE EXECUTE ON FUNCTION public.closing_insurance_split(UUID, DATE) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.closing_insurance_split(UUID, DATE) TO service_role;

COMMIT;
