-- ROLLBACK: T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE
-- 직전(20260711120000_..._server_masking.sql) 함수정의 스냅샷 그대로 복원 = normalize(NFC) 미적용.
-- 유일 revert: 서브쿼리 nm 파생 normalize(COALESCE(...), NFC) → COALESCE(...) 로 원복.
-- 나머지(시그니처·반환형·권한·SECDEF·owner·search_path='')는 up 과 동일 → 무변경.
-- 데이터 mutation 없음 (함수 정의만 원복). 멱등 CREATE OR REPLACE.

BEGIN;

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
      COALESCE(r.customer_name,  c.name)  AS nm,
      COALESCE(r.customer_phone, c.phone) AS ph,
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

GRANT  EXECUTE ON FUNCTION public.fn_selfcheckin_today_reservations(UUID, DATE)
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_today_reservations(UUID, DATE) IS
  'T-20260711-foot-SELFCHECKIN-SERVER-MASKING: 셀프체크인 anon 오늘 예약자 목록. '
  '서버측 마스킹(name=성+끝자 홍*동, phone=뒤 4자리) → raw PHI anon 미전송(계약 §15-5-4 canonical). '
  '반환면 상한: id/customer_id opaque UUID, reservation_time 그대로, visit_type coarse. '
  'clinic_id + date + status=confirmed 스코프 유지. + search_path='''' 핀(§1-8 guardrail).';

COMMIT;
