-- ROLLBACK — T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK CARVE-A (closing_insurance_split voided parity)
-- 역전: 20260806150000 v1.7 TOTALS-RECOMPUTE-PORT 본문 verbatim 복원(voided_at 필터 2줄 제거) + grant 재봉인.
-- ★배포순서: FE G2 parity 롤백/미배포 상태에서만(함수와 FE 는 동일 voided 집계 정합을 공유).
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
  SELECT COALESCE(dc.package_card_total,0)     + COALESCE(dc.single_card_total,0)
       + COALESCE(dc.package_cash_total,0)     + COALESCE(dc.single_cash_total,0)
       + COALESCE(dc.package_transfer_total,0) + COALESCE(dc.single_transfer_total,0)
    INTO v_sys_total
    FROM public.daily_closings dc
   WHERE dc.clinic_id = p_clinic AND dc.close_date = p_date
   ORDER BY dc.revision DESC
   LIMIT 1;
  v_sys_total := COALESCE(v_sys_total, 0);

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
         AND sc.is_simulation IS NOT TRUE);

  v_copay  := GREATEST(0, LEAST(COALESCE(v_copay_raw, 0), GREATEST(v_sys_total, 0)));
  v_nonins := v_sys_total - v_copay;

  SELECT COALESCE(SUM(sc.insurance_covered_amount), 0)
    INTO v_covered
    FROM public.service_charges sc
    LEFT JOIN public.check_ins ci ON ci.id = sc.check_in_id
   WHERE COALESCE(sc.clinic_id, ci.clinic_id) = p_clinic
     AND sc.is_simulation IS NOT TRUE
     AND sc.is_insurance_covered = true
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
  'T-CLOSING-HERALD(foot) v1.7 TOTALS-RECOMPUTE-PORT: 급여구분축. total=daily_closings 확정 구성분 authority. '
  'rev_copay_self=단건 급여청구분(service_charges covered)·rev_noninsurance=total−copay(패키지 전건 비급여 흡수 DA Q3-2). '
  'copay+nonins==total(INV2). rev_insurance_covered=공단부담(명세 grain·total 밖·>=0·INV3 독립). ledger net 폐기.';

REVOKE EXECUTE ON FUNCTION public.closing_insurance_split(UUID, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.closing_insurance_split(UUID, DATE) FROM anon;
REVOKE EXECUTE ON FUNCTION public.closing_insurance_split(UUID, DATE) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.closing_insurance_split(UUID, DATE) TO service_role;

COMMIT;
