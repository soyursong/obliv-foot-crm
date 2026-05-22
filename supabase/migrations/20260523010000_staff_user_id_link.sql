-- T-20260523-foot-ACCT-HISTORY-VERIFY
-- staff.user_id → user_profiles.id 연결 (계정별 이력 추적 활성화)
--
-- 배경: current_staff_id() 함수가 staff.user_id = auth.uid() 로 조회하는데
--        staff.user_id가 전부 null → 직원 본인 계정 로그인 시 이력 기록 불가.
--        5/26 시뮬레이션 전 필수 데이터 픽스.
--
-- 매핑 기준: user_profiles.name = staff.name (이름 일치 확인 후 적용)
-- 적용일: 2026-05-23 (direct DB UPDATE 후 migration 파일 소급 작성)
--
-- ⚠️  이미 DB에 직접 적용됨. 이 파일은 SSOT 문서화 + rollback SQL 제공용.

-- 치료사 (therapist) - 16건
UPDATE staff SET user_id = '44cab5cb-44e1-4813-83c3-338325fd0c83' WHERE id = 'e01d9c38-4748-4119-9071-5a233decf5aa'; -- 강혜인
UPDATE staff SET user_id = 'b4e0b43b-0608-444f-a7fc-35d424cb9bfd' WHERE id = 'b038a053-7981-4d69-8771-183e027b1b67'; -- 김성우
UPDATE staff SET user_id = '63c387c0-eb89-4573-a47e-a7a128c27e94' WHERE id = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b'; -- 김규리
UPDATE staff SET user_id = '2c0a051e-1e98-4218-a0ad-66ad5d7c8277' WHERE id = '6df79a63-6812-4a02-b9d4-19d6c1b6ca2c'; -- 백민영
UPDATE staff SET user_id = 'b77f9f18-a154-4bb8-82f9-455f3270e5b7' WHERE id = '7c24cd3b-8e52-4c72-9652-e14f75151514'; -- 임별
UPDATE staff SET user_id = '47718871-0d23-4523-958b-5945515db6e0' WHERE id = '8d244cee-3a7c-4220-8e1c-43e03c8e505a'; -- 조선미
UPDATE staff SET user_id = 'f972cf34-8eb6-4898-947f-85d8c295181f' WHERE id = '1d2165fa-5263-4521-9402-d19b8ceae451'; -- 서은정 (active)
UPDATE staff SET user_id = 'c4901b59-f0d6-4721-ba1e-576c89ac0ad0' WHERE id = 'e20483bc-6b24-46b4-99c5-be150165a18b'; -- 김유리
UPDATE staff SET user_id = 'a5f7ba13-5edd-438a-beac-5148473e8888' WHERE id = '7d2747cc-f669-43c5-b611-806808b5dfb0'; -- 윤시하
UPDATE staff SET user_id = '5730c06a-f22e-4022-8a6a-6bdb200ede65' WHERE id = '03642b85-4b30-48e4-b762-c2d04e6af7f3'; -- 최민지
UPDATE staff SET user_id = 'ddb4f4ae-5a9c-43ea-b23a-35f8bba86667' WHERE id = '8c21c9ab-eb83-4688-a95b-4566c301c470'; -- 최다혜

-- 상담사 (consultant)
UPDATE staff SET user_id = 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12' WHERE id = '10eacaa8-fa6b-4615-8bf1-02b4f49cb6ed'; -- 김주연
UPDATE staff SET user_id = '02540f48-f877-4121-8e92-83b4e993e76b' WHERE id = 'b311593d-9e46-4ac8-9424-6b0fa1689a06'; -- 엄경은
UPDATE staff SET user_id = '3bd596ca-036b-423c-a4f6-3cbab8083133' WHERE id = 'c851fbb1-31ce-4714-b91c-03e9cb8af566'; -- 정연주
UPDATE staff SET user_id = 'cd102e05-f16a-42ad-8ef3-a52e405990a2' WHERE id = 'ffff7c0d-4dae-443c-9c61-2f60b2f1b760'; -- 송지현
UPDATE staff SET user_id = '58735357-8bb1-4da4-8e3c-e8fb0744126c' WHERE id = '5b3a3a5f-9d14-4099-897b-95c6ae86b763'; -- 김수린

-- 검증 쿼리 (확인용)
-- SELECT name, role, user_id IS NOT NULL as linked, active
-- FROM staff WHERE user_id IS NOT NULL ORDER BY role, name;
