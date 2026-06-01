-- T-20260601-foot-SELFLOGIN-RESV-LIST-QR
-- 셀프접수(anon) 오늘 예약자 목록 조회 함수 (롱레 get_today_reservations 상당 포팅)
--
-- 신규 함수: fn_selfcheckin_today_reservations(p_clinic_id, p_date)
--   - 셀프접수 화면(/checkin/:clinicSlug, anon)에서 "예약하고 왔어요" 선택 시
--     오늘(KST) 예약자 목록을 불러와 화면에 마스킹 표시하기 위한 조회 함수.
--   - FE 가 수신 즉시 maskName/maskPhone 으로 마스킹 변환 → 비마스킹 원본은 ref 에만 보관.
--
-- 보안 조건:
--   - SECURITY DEFINER → anon RLS 우회. 단, 최소 노출 원칙:
--       · clinic_id 로 스코프 제한 (지점 격리)
--       · 인자로 받은 날짜(p_date)의 예약만 — FE 는 항상 오늘(KST) 만 전달
--       · status = 'confirmed' (= 아직 체크인 전) 예약만 노출 → checked_in/cancelled/noshow 제외
--   - 반환 컬럼은 이름/전화/예약시간/방문유형으로 한정 (메모·서비스 등 부가 PII 미반환).
--   - GRANT anon 은 의도적 (셀프접수는 비로그인 키오스크). 호출 자체로 노출되는 PII 는
--     FE 마스킹 전제 + status='confirmed' 한정으로 최소화.
--
-- 롤백: 20260601190000_selfcheckin_today_reservations_fn.rollback.sql

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
  'T-20260601-foot-SELFLOGIN-RESV-LIST-QR: 셀프접수 anon 오늘 예약자 목록 조회.'
  ' 롱레 get_today_reservations 상당. clinic_id 스코프 + 인자 날짜 + status=confirmed 한정.'
  ' FE 수신 즉시 마스킹 변환 전제 — 비마스킹 원본은 ref 에만 보관.';

COMMIT;
