-- T-20260523-foot-ACCT-HISTORY-VERIFY ROLLBACK
-- staff.user_id 링크 제거 (원복: null로 되돌림)
--
-- ⚠️ 주의: 이 롤백을 실행하면 current_staff_id() = null이 되어
--           staff 계정 RLS 정책 전체가 비활성화됨.

UPDATE staff SET user_id = NULL WHERE id IN (
  'e01d9c38-4748-4119-9071-5a233decf5aa', -- 강혜인
  'b038a053-7981-4d69-8771-183e027b1b67', -- 김성우
  '3a0c6774-2bd9-4018-bb38-ef6fab75d04b', -- 김규리
  '6df79a63-6812-4a02-b9d4-19d6c1b6ca2c', -- 백민영
  '7c24cd3b-8e52-4c72-9652-e14f75151514', -- 임별
  '8d244cee-3a7c-4220-8e1c-43e03c8e505a', -- 조선미
  '1d2165fa-5263-4521-9402-d19b8ceae451', -- 서은정
  'e20483bc-6b24-46b4-99c5-be150165a18b', -- 김유리
  '7d2747cc-f669-43c5-b611-806808b5dfb0', -- 윤시하
  '03642b85-4b30-48e4-b762-c2d04e6af7f3', -- 최민지
  '8c21c9ab-eb83-4688-a95b-4566c301c470', -- 최다혜
  '10eacaa8-fa6b-4615-8bf1-02b4f49cb6ed', -- 김주연
  'b311593d-9e46-4ac8-9424-6b0fa1689a06', -- 엄경은
  'c851fbb1-31ce-4714-b91c-03e9cb8af566', -- 정연주
  'ffff7c0d-4dae-443c-9c61-2f60b2f1b760', -- 송지현
  '5b3a3a5f-9d14-4099-897b-95c6ae86b763'  -- 김수린
);
