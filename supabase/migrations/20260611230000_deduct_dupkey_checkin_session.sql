-- T-20260611-foot-DEDUCT-DUPKEY-SUBTHERAPIST (AC1 — DB 제약 재설계)
-- ★ supervisor DB 게이트 통과 전 prod 적용 금지 (dev_ops_policy DB 변경 규칙)
--
-- 배경: `unique_package_checkin UNIQUE (package_id, check_in_id)` 이
--   정당한 "같은 날(같은 내원) 같은 패키지 복수 차감"(ⓠ1=B, 김주연 총괄 2026-06-11 확정)을 막음.
--   같은 내원에 1회차 차감 후 2회차/대체치료 기록을 추가하려 하면 23505 중복키.
--
-- 변경: (package_id, check_in_id) → (package_id, check_in_id, session_number) 복합 unique.
--   - 같은 내원 안에서 서로 다른 session_number 차감은 허용(추가 소진).
--   - 동일 (package_id, check_in_id, session_number) 재INSERT(이중 클릭 등)만 차단 — 오차감 가드 유지.
--   - check_in_id IS NULL 행은 PG에서 NULL distinct → 기존과 동일하게 제약 미적용.
--
-- ⚠ 롤백 윈도: 멀티 차감(같은 check_in_id·다른 session_number) 행이 1건이라도 생기면
--   원 제약 `unique_package_checkin (package_id, check_in_id)` 재부착이 중복행으로 실패 → 사실상 one-way.
--   supervisor가 롤백 한계를 명시하고, 롤백은 멀티 차감 발생 전에만 clean 함.

ALTER TABLE package_sessions
  DROP CONSTRAINT IF EXISTS unique_package_checkin;

ALTER TABLE package_sessions
  ADD CONSTRAINT unique_package_checkin_session UNIQUE (package_id, check_in_id, session_number);
