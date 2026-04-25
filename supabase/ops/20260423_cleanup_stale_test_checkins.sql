-- T-20260422-foot-PW05: 대시보드 테스트 데이터 잔존 정리
-- 운영자가 Supabase SQL editor 에서 수동 실행.
-- 재실행 안전 (DELETE 결과 0건이면 no-op).

-- 0) 사전 확인: 지금 잔존한 것의 실체 파악
--   SELECT id, customer_name, status, checked_in_at,
--          NOW() - checked_in_at AS elapsed
--   FROM check_ins
--   WHERE status NOT IN ('done','cancelled')
--     AND checked_in_at < NOW() - INTERVAL '12 hours'
--   ORDER BY checked_in_at ASC;

BEGIN;

-- 1) is_simulation=TRUE 고객의 체크인 전량 제거 (수행 전 실제 clinic_id 지정 권장)
DELETE FROM status_transitions
WHERE check_in_id IN (
  SELECT ci.id FROM check_ins ci
  JOIN customers c ON c.id = ci.customer_id
  WHERE c.is_simulation = TRUE
);

DELETE FROM check_in_services
WHERE check_in_id IN (
  SELECT ci.id FROM check_ins ci
  JOIN customers c ON c.id = ci.customer_id
  WHERE c.is_simulation = TRUE
);

DELETE FROM check_ins
WHERE customer_id IN (
  SELECT id FROM customers WHERE is_simulation = TRUE
);

-- 2) 이름 '이정환' 또는 phone prefix 로컬 테스트로 기록된 체크인 제거
--    (is_simulation 플래그 없이 생성된 경우 대비)
DELETE FROM status_transitions
WHERE check_in_id IN (
  SELECT id FROM check_ins
  WHERE customer_name = '이정환'
     OR customer_phone LIKE '010-0000-%'
     OR customer_phone LIKE '010-1111-%'
);

DELETE FROM check_in_services
WHERE check_in_id IN (
  SELECT id FROM check_ins
  WHERE customer_name = '이정환'
     OR customer_phone LIKE '010-0000-%'
     OR customer_phone LIKE '010-1111-%'
);

DELETE FROM check_ins
WHERE customer_name = '이정환'
   OR customer_phone LIKE '010-0000-%'
   OR customer_phone LIKE '010-1111-%';

-- 3) 12시간 이상 방치된 non-done/non-cancelled 체크인 → cancelled 로 마킹
--    (데이터 보존, 대시보드 정리 효과)
UPDATE check_ins
SET status = 'cancelled',
    completed_at = COALESCE(completed_at, NOW())
WHERE status NOT IN ('done','cancelled')
  AND checked_in_at < NOW() - INTERVAL '12 hours';

COMMIT;

-- 사후 확인:
--   SELECT status, COUNT(*) FROM check_ins GROUP BY status;

-- 별건 권장:
--   일일 자정 pg_cron 으로 step (3) 자동 실행 (foot-PW05-AUTOCLOSE 후속 티켓).
