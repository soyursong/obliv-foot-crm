-- ROLLBACK — T-20260731-foot-TESTPAY-SANDBOX-EXCLUDE (is_simulation physlink ARMING)
-- 역순 additive drop: 제외필터 복원 → write-path 트리거/함수 제거 → 인덱스 제거 → 컬럼 제거.
-- ⚠ 컬럼 DROP 은 파괴적(값 소실). 실운영 롤백 시 데이터 영향 검토 후 집행. sim 컬럼은 forward-only·소급 backfill 無.
-- split 함수 정의는 apply 직전 prod pg_get_functiondef 원문(20260718140000 herald pilot 정본과 동치)으로 복원.

BEGIN;

-- 3-rev) 제외필터 복원 — closing_source_split / closing_insurance_split 를 is_simulation conjunct 제거 이전 정의로.
CREATE OR REPLACE FUNCTION public.closing_source_split(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH net AS (
    SELECT
      (CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END) AS net_amt,
      r.source_system AS src
    FROM public.payments p
    LEFT JOIN public.check_ins ci   ON ci.id = p.check_in_id
    LEFT JOIN public.reservations r ON r.id = ci.reservation_id
    WHERE COALESCE(p.clinic_id, ci.clinic_id) = p_clinic
      AND p.method IN ('card','cash','transfer')      -- ★Q5: membership(선불 use) S밖
      AND COALESCE(
            NULLIF(to_jsonb(p) ->> 'revenue_date', '')::date,
            CASE WHEN p.payment_type = 'refund'
                 THEN NULLIF(to_jsonb(p) ->> 'refund_date', '')::date ELSE NULL END,
            ci.checked_in_at::date,
            p.created_at::date
          ) = p_date
  )
  SELECT jsonb_build_object(
    'revenue_ad',      COALESCE(SUM(net_amt) FILTER (WHERE src = 'dopamine'), 0),
    'revenue_organic', COALESCE(SUM(net_amt) FILTER (WHERE src IS DISTINCT FROM 'dopamine'), 0),
    'total',           COALESCE(SUM(net_amt), 0)
  )
  FROM net;
$$;

CREATE OR REPLACE FUNCTION public.closing_insurance_split(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH net AS (
    SELECT
      (CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END) AS net_amt,
      EXISTS (
        SELECT 1 FROM public.service_charges sc
        WHERE sc.check_in_id = p.check_in_id
          AND sc.is_insurance_covered = true
      ) AS is_ins
    FROM public.payments p
    LEFT JOIN public.check_ins ci ON ci.id = p.check_in_id
    WHERE COALESCE(p.clinic_id, ci.clinic_id) = p_clinic
      AND p.method IN ('card','cash','transfer')      -- S 동일 유니버스(INV5)
      AND COALESCE(
            NULLIF(to_jsonb(p) ->> 'revenue_date', '')::date,
            CASE WHEN p.payment_type = 'refund'
                 THEN NULLIF(to_jsonb(p) ->> 'refund_date', '')::date ELSE NULL END,
            ci.checked_in_at::date,
            p.created_at::date
          ) = p_date
  ),
  covered AS (
    SELECT COALESCE(SUM(sc.insurance_covered_amount), 0) AS ins_covered
    FROM public.service_charges sc
    LEFT JOIN public.check_ins ci ON ci.id = sc.check_in_id
    WHERE COALESCE(sc.clinic_id, ci.clinic_id) = p_clinic
      AND sc.is_insurance_covered = true
      AND COALESCE(ci.checked_in_at::date, sc.calculated_at::date) = p_date
  )
  SELECT jsonb_build_object(
    'rev_copay_self',       COALESCE((SELECT SUM(net_amt) FILTER (WHERE is_ins)     FROM net), 0),
    'rev_noninsurance',     COALESCE((SELECT SUM(net_amt) FILTER (WHERE NOT is_ins) FROM net), 0),
    'rev_insurance_covered',(SELECT ins_covered FROM covered),
    'total',                COALESCE((SELECT SUM(net_amt) FROM net), 0)
  );
$$;

-- 2-rev) write-path 트리거 + 함수 제거.
DROP TRIGGER IF EXISTS trg_payments_sim_stamp_insert         ON public.payments;
DROP TRIGGER IF EXISTS trg_service_charges_sim_stamp_insert  ON public.service_charges;
DROP TRIGGER IF EXISTS trg_package_payments_sim_stamp_insert ON public.package_payments;
DROP FUNCTION IF EXISTS public.stamp_is_simulation_from_customer();

-- 1-rev) 인덱스 + 컬럼 제거 (⚠ 파괴적 — 컬럼 값 소실).
DROP INDEX IF EXISTS public.idx_payments_simulation;
DROP INDEX IF EXISTS public.idx_service_charges_simulation;
DROP INDEX IF EXISTS public.idx_package_payments_simulation;

ALTER TABLE public.payments          DROP COLUMN IF EXISTS is_simulation;
ALTER TABLE public.service_charges   DROP COLUMN IF EXISTS is_simulation;
ALTER TABLE public.package_payments  DROP COLUMN IF EXISTS is_simulation;

COMMIT;
