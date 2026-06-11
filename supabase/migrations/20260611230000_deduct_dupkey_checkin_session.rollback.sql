-- ROLLBACK: T-20260611-foot-DEDUCT-DUPKEY-SUBTHERAPIST (AC1)
-- ⚠ ONE-WAY 주의: 멀티 차감(같은 package_id·check_in_id·다른 session_number) 행이 1건이라도
--   생성된 뒤에는 아래 ADD CONSTRAINT 가 중복행으로 실패함. 롤백은 멀티 차감 발생 전에만 clean.
--   롤백 전 점검 쿼리:
--     SELECT package_id, check_in_id, count(*)
--       FROM package_sessions WHERE check_in_id IS NOT NULL
--       GROUP BY package_id, check_in_id HAVING count(*) > 1;
--   결과가 1행이라도 있으면 원 제약 재부착 불가 → escape hatch는 복합 unique 유지.

ALTER TABLE package_sessions
  DROP CONSTRAINT IF EXISTS unique_package_checkin_session;

ALTER TABLE package_sessions
  ADD CONSTRAINT unique_package_checkin UNIQUE (package_id, check_in_id);
