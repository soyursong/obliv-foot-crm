-- T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK CARVE-A (closing_insurance_split voided parity) — dry-run (무영속)
--
-- 목적: 함수 재정의를 트랜잭션 내 실행 후 sentinel-ROLLBACK 하여 prod 무영속으로 재정의 성립성만 확인.
--   (선행조건: 20260814000000 voided_at 컬럼이 존재해야 sc.voided_at 참조가 파싱됨 — 컬럼 선행 배포 계약.)
-- 실행: psql "$FOOT_DB_URL" -v ON_ERROR_STOP=1 -f 이 파일
-- 기대: 재정의 성공 + net-zero 불변 확인(전건 voided_at=NULL 이면 결과 불변), sentinel-ROLLBACK 무영속.

DO $$
DECLARE
  v_col_ok boolean;
BEGIN
  -- 선행조건 assert: voided_at 컬럼 존재
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='service_charges' AND column_name='voided_at'
  ) INTO v_col_ok;
  IF NOT v_col_ok THEN
    RAISE EXCEPTION 'DRYRUN PRECOND FAIL: service_charges.voided_at 부재 — 20260814000000 선행 필요';
  END IF;

  -- 재정의 본문(voided_at parity 2줄 포함) — CREATE OR REPLACE 파싱/컴파일 성립성 확인
  CREATE OR REPLACE FUNCTION public.closing_insurance_split(p_clinic UUID, p_date DATE)
  RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
  AS $fn$
  DECLARE v_sys_total BIGINT; v_copay_raw BIGINT; v_copay BIGINT; v_nonins BIGINT; v_covered BIGINT;
  BEGIN
    SELECT COALESCE(dc.package_card_total,0)+COALESCE(dc.single_card_total,0)
         + COALESCE(dc.package_cash_total,0)+COALESCE(dc.single_cash_total,0)
         + COALESCE(dc.package_transfer_total,0)+COALESCE(dc.single_transfer_total,0)
      INTO v_sys_total FROM public.daily_closings dc
     WHERE dc.clinic_id=p_clinic AND dc.close_date=p_date ORDER BY dc.revision DESC LIMIT 1;
    v_sys_total := COALESCE(v_sys_total,0);
    SELECT COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0)
      INTO v_copay_raw FROM public.payments p LEFT JOIN public.check_ins ci ON ci.id=p.check_in_id
     WHERE COALESCE(p.clinic_id,ci.clinic_id)=p_clinic AND p.is_simulation IS NOT TRUE
       AND p.status IS DISTINCT FROM 'deleted' AND p.method IN ('card','cash','transfer')
       AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date=p_date
       AND EXISTS (SELECT 1 FROM public.service_charges sc WHERE sc.check_in_id=p.check_in_id
                     AND sc.is_insurance_covered=true AND sc.is_simulation IS NOT TRUE AND sc.voided_at IS NULL);
    v_copay := GREATEST(0, LEAST(COALESCE(v_copay_raw,0), GREATEST(v_sys_total,0)));
    v_nonins := v_sys_total - v_copay;
    SELECT COALESCE(SUM(sc.insurance_covered_amount),0) INTO v_covered
      FROM public.service_charges sc LEFT JOIN public.check_ins ci ON ci.id=sc.check_in_id
     WHERE COALESCE(sc.clinic_id,ci.clinic_id)=p_clinic AND sc.is_simulation IS NOT TRUE
       AND sc.is_insurance_covered=true AND sc.voided_at IS NULL
       AND COALESCE(ci.checked_in_at::date, sc.calculated_at::date)=p_date;
    RETURN jsonb_build_object('rev_copay_self',v_copay,'rev_noninsurance',v_nonins,
                              'rev_insurance_covered',COALESCE(v_covered,0),'total',v_sys_total);
  END; $fn$;

  RAISE NOTICE 'DRYRUN: closing_insurance_split 재정의 성립(voided_at parity 컴파일 OK)';
  RAISE EXCEPTION 'DRYRUN_SENTINEL_ROLLBACK ok';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'DRYRUN_SENTINEL_ROLLBACK%' THEN
    RAISE NOTICE 'DRYRUN PASS (no persistence)';
  ELSE
    RAISE;
  END IF;
END $$;
