-- ROLLBACK: T-20260810-foot-SELFCHECKIN-RPC-STATUS-WIDEN
-- 직전 prosrc(status='confirmed') 복원. 완전 가역 (read-set widen 되돌림 → false-empty 재발이나 순손실 0).
--   banner  → 20260615170000_rls_clinic_isolation_anon_rpc_additive.sql L38-54 정의
--   today   → 20260721120000_selfcheckin_today_reservations_nfc_normalize_mask.sql L40-107 정의

BEGIN;

-- ── 1) fn_selfcheckin_reservation_banner : status IN (...) → status = 'confirmed' ──
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_reservation_banner(
  p_clinic_id UUID,
  p_phone     TEXT
)
RETURNS TABLE(reservation_time TIME WITHOUT TIME ZONE, visit_type TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.reservation_time, r.visit_type
    FROM reservations r
   WHERE r.clinic_id = p_clinic_id
     AND r.reservation_date = (now() AT TIME ZONE 'Asia/Seoul')::date
     AND r.status = 'confirmed'
     AND regexp_replace(COALESCE(r.customer_phone,''),'\D','','g')
           = regexp_replace(COALESCE(p_phone,''),'\D','','g')
     AND length(regexp_replace(COALESCE(p_phone,''),'\D','','g')) >= 8
   ORDER BY r.reservation_time ASC
   LIMIT 1
$$;

-- ── 2) fn_selfcheckin_today_reservations : status IN (...) → status = 'confirmed' ──
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_today_reservations(
  p_clinic_id UUID,
  p_date      DATE
)
RETURNS TABLE(
  id               UUID,
  customer_id      UUID,
  customer_name    TEXT,
  customer_phone   TEXT,
  reservation_time TIME WITHOUT TIME ZONE,
  visit_type       TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    t.id,
    t.customer_id,
    CASE
      WHEN t.nm IS NULL OR btrim(t.nm) = ''       THEN t.nm
      WHEN char_length(btrim(t.nm)) = 1           THEN btrim(t.nm)
      WHEN char_length(btrim(t.nm)) = 2           THEN left(btrim(t.nm), 1) || '*'
      ELSE left(btrim(t.nm), 1)
           || repeat('*', char_length(btrim(t.nm)) - 2)
           || right(btrim(t.nm), 1)
    END                                                        AS customer_name,
    CASE
      WHEN t.ph IS NULL                              THEN NULL
      WHEN regexp_replace(t.ph, '\D', '', 'g') = ''  THEN NULL
      ELSE right(regexp_replace(t.ph, '\D', '', 'g'), 4)
    END                                                        AS customer_phone,
    t.reservation_time,
    t.visit_type
  FROM (
    SELECT
      r.id,
      r.customer_id,
      normalize(COALESCE(r.customer_name,  c.name), NFC)  AS nm,
      COALESCE(r.customer_phone, c.phone)                 AS ph,
      r.reservation_time,
      r.visit_type
    FROM public.reservations r
    LEFT JOIN public.customers c ON c.id = r.customer_id
    WHERE r.clinic_id        = p_clinic_id
      AND r.reservation_date = p_date
      AND r.status           = 'confirmed'
  ) t
  ORDER BY t.reservation_time ASC;
$$;

ALTER  FUNCTION public.fn_selfcheckin_today_reservations(UUID, DATE) OWNER TO postgres;

GRANT  EXECUTE ON FUNCTION public.fn_selfcheckin_reservation_banner(UUID, TEXT)
  TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_selfcheckin_today_reservations(UUID, DATE)
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_today_reservations(UUID, DATE) IS
  'T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE (base T-20260711-foot-SELFCHECKIN-SERVER-MASKING): '
  '셀프체크인 anon 오늘 예약자 목록. 서버측 마스킹(name=성+끝자 홍*동, phone=뒤 4자리) → raw PHI anon 미전송. '
  '마스킹 입력 name 을 normalize(NFC) 로 정규화 → NFD 자모분해 저장값도 완성형 글자 기준 마스킹(강*은). '
  'clinic_id + date + status=confirmed 스코프 유지. + search_path='''' 핀(§1-8 guardrail). 데이터 mutation 0.';

COMMIT;
