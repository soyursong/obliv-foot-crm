-- ROLLBACK: T-20260529-foot-CHART-OPEN-FAIL
-- 차트 열기 실패(오인숙 고객) 조사 중 적용한 데이터 보정 되돌리기.
-- 변경 내용: reservations.066b2cc3-af5a-4745-87fd-4c48b09a1a02 의 customer_id 를
--            edaba167(오인숙) 로 직접 연결 (1건) → 원래 NULL 로 복구.
--
-- 적용 전 체크 (현재값이 edaba167 인지 확인):
--   SELECT id, customer_id
--   FROM reservations
--   WHERE id = '066b2cc3-af5a-4745-87fd-4c48b09a1a02';
--
-- 기대: customer_id = 'edaba167...' (보정 적용 상태) → 롤백 후 NULL

UPDATE reservations
SET customer_id = NULL
WHERE id = '066b2cc3-af5a-4745-87fd-4c48b09a1a02'
  AND customer_id IS NOT NULL;

-- 적용 후 확인:
--   SELECT id, customer_id
--   FROM reservations
--   WHERE id = '066b2cc3-af5a-4745-87fd-4c48b09a1a02';
--   → customer_id IS NULL 이면 롤백 성공
