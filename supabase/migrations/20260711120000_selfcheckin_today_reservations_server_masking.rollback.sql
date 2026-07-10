-- 롤백: T-20260711-foot-SELFCHECKIN-SERVER-MASKING
-- 서버측 마스킹 함수 → 원 함수(raw customer_name/customer_phone 반환, 마이그 20260601190000) 복원.
-- ※ 롤백 시 raw PHI 가 다시 anon 경로로 전송됨(§15-5-1 가드레일 미충족 상태로 되돌아감) —
--    긴급 회귀 대응 목적으로만 사용. 롤백 후에는 반드시 재하드닝 후속을 건다.

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
SET search_path = public
AS $$
  SELECT
    r.id,
    r.customer_id,
    COALESCE(r.customer_name,  c.name)  AS customer_name,
    COALESCE(r.customer_phone, c.phone) AS customer_phone,
    r.reservation_time,
    r.visit_type
  FROM reservations r
  LEFT JOIN customers c ON c.id = r.customer_id
  WHERE r.clinic_id        = p_clinic_id
    AND r.reservation_date = p_date
    AND r.status           = 'confirmed'
  ORDER BY r.reservation_time ASC;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_today_reservations(UUID, DATE)
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_today_reservations IS
  'T-20260601-foot-SELFLOGIN-RESV-LIST-QR: 셀프접수 anon 오늘 예약자 목록 조회. (rollback of SERVER-MASKING)';

COMMIT;
