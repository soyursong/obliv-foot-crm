-- DRY-RUN: T-20260810-foot-SELFCHECKIN-RPC-STATUS-WIDEN
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · up.sql 의 BEGIN/COMMIT(txn-control) 는 strip. 아래 자체 BEGIN...ROLLBACK 안에서 CREATE OR REPLACE 실행.
--   · tx 내에서 status widen 반영·시그니처 불변 확인 후 ROLLBACK → 실적용 0.
--   · ROLLBACK 이후 post-probe(introspection)로 prod 실재 함수정의에 checked_in 미포함(=무영속) 재확인.
-- 프로드 rxlomoozakkjesdqjtvd 대상. 실행: psql "$FOOT_DB_URL" -f 이 파일.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- PART A — apply-전 baseline (기대: 두 함수 prosrc 에 checked_in 미포함 = confirmed-only)
-- ══════════════════════════════════════════════════════════════════════════════
SELECT p.proname, (p.prosrc LIKE '%checked_in%') AS has_widen_before
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('fn_selfcheckin_reservation_banner','fn_selfcheckin_today_reservations');
-- 기대: 둘 다 has_widen_before=false

-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — up 마이그(txn-control strip) 를 rolled-back tx 안에서 실적용 후 회귀 → ROLLBACK
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_reservation_banner(
  p_clinic_id UUID, p_phone TEXT
)
RETURNS TABLE(reservation_time TIME WITHOUT TIME ZONE, visit_type TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.reservation_time, r.visit_type
    FROM reservations r
   WHERE r.clinic_id = p_clinic_id
     AND r.reservation_date = (now() AT TIME ZONE 'Asia/Seoul')::date
     AND r.status IN ('confirmed','reserved','checked_in')
     AND regexp_replace(COALESCE(r.customer_phone,''),'\D','','g')
           = regexp_replace(COALESCE(p_phone,''),'\D','','g')
     AND length(regexp_replace(COALESCE(p_phone,''),'\D','','g')) >= 8
   ORDER BY r.reservation_time ASC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_today_reservations(
  p_clinic_id UUID, p_date DATE
)
RETURNS TABLE(
  id UUID, customer_id UUID, customer_name TEXT, customer_phone TEXT,
  reservation_time TIME WITHOUT TIME ZONE, visit_type TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT t.id, t.customer_id,
    CASE
      WHEN t.nm IS NULL OR btrim(t.nm) = ''  THEN t.nm
      WHEN char_length(btrim(t.nm)) = 1      THEN btrim(t.nm)
      WHEN char_length(btrim(t.nm)) = 2      THEN left(btrim(t.nm), 1) || '*'
      ELSE left(btrim(t.nm), 1) || repeat('*', char_length(btrim(t.nm)) - 2) || right(btrim(t.nm), 1)
    END AS customer_name,
    CASE
      WHEN t.ph IS NULL                              THEN NULL
      WHEN regexp_replace(t.ph, '\D', '', 'g') = ''  THEN NULL
      ELSE right(regexp_replace(t.ph, '\D', '', 'g'), 4)
    END AS customer_phone,
    t.reservation_time, t.visit_type
  FROM (
    SELECT r.id, r.customer_id,
      normalize(COALESCE(r.customer_name, c.name), NFC) AS nm,
      COALESCE(r.customer_phone, c.phone)               AS ph,
      r.reservation_time, r.visit_type
    FROM public.reservations r
    LEFT JOIN public.customers c ON c.id = r.customer_id
    WHERE r.clinic_id = p_clinic_id AND r.reservation_date = p_date
      AND r.status IN ('confirmed','reserved','checked_in')
  ) t
  ORDER BY t.reservation_time ASC;
$$;

-- 시그니처·SECDEF·search_path·widen 반영 검증 (tx 내)
SELECT p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner,
       pg_get_function_identity_arguments(p.oid) AS args,
       (p.prosrc LIKE '%checked_in%') AS has_widen
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('fn_selfcheckin_reservation_banner','fn_selfcheckin_today_reservations')
 ORDER BY p.proname;
-- 기대(tx 내):
--   banner : prosecdef=true, proconfig={"search_path=public, pg_temp"}, args='p_clinic_id uuid, p_phone text', has_widen=true
--   today  : prosecdef=true, proconfig={search_path=""}, owner=postgres, args='p_clinic_id uuid, p_date date', has_widen=true

ROLLBACK;   -- ★ 실적용 0

-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — POST-PROBE (무영속 재확인) : ROLLBACK 이후 prod 실재 정의에 checked_in 미포함
-- ══════════════════════════════════════════════════════════════════════════════
SELECT p.proname, (p.prosrc LIKE '%checked_in%') AS still_has_widen
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('fn_selfcheckin_reservation_banner','fn_selfcheckin_today_reservations');
-- 기대: 둘 다 still_has_widen=false → dry-run 이 prod 함수정의를 변경하지 않았음(sentinel-bypass 아님) 확인.
