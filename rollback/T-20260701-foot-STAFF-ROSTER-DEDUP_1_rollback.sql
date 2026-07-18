-- ROLLBACK SQL — T-20260701-foot-STAFF-ROSTER-DEDUP #1 박소예 (post-COMMIT 재난복구용)
-- freeze 매니페스트 스냅샷 기반. 재귀속 fk 원상 + CANON active 원상 + DUP active/name 원상.
-- 실행 전 반드시 현 상태 확인. per-person 단일 txn 으로 감쌀 것.
BEGIN;
-- 재귀속 원상: CANON → DUP (freeze 매니페스트 id셋 명시)
UPDATE duty_roster      SET doctor_id='5c17e4bc-e948-4dc4-a8cf-37904873edeb'        WHERE id IN ('000caf90-d7ab-4b22-81be-47459df88df5','32169004-92f5-46c8-94e6-008c1060ec2e','61eab4f8-e0de-495f-ae8a-131378d9e70a','92ffbdb9-aa84-4292-b0fc-b705f03d0d6e','aa5222a8-c90f-4840-be62-c820c3cadbf3','b0c19633-ba56-4be7-a202-edaa23b6c22b','c9673315-ad01-463d-b6bd-402482d5a9ee','dfed0182-7c92-42d6-89ea-d4cf859f21c9');
UPDATE package_sessions SET performed_by='5c17e4bc-e948-4dc4-a8cf-37904873edeb'     WHERE id IN ('316b0ce5-b33b-43fb-b50a-0c6418dce79e','3817600c-99d8-4078-a0b1-0b0e50242c85','38441f3b-095d-41e2-8fa8-7e38c83ae330','56d6db3f-2d9b-4562-b66e-8022fd5b1858','750141d6-aa5c-4ec9-bbc5-d0f42879273b','7ee96f89-27f6-467c-90bf-566751d302a0','98ca65d2-d015-4a49-a249-bbb8c9df5bb1','ae0d3ed5-e5c0-4ca2-abfc-49686e052fdd','b63ed621-e777-44b5-9c1c-b8016e05e08e','bf53e640-e90f-4bb8-bec7-3ceed73134ad','ca6b789c-8ddb-48e1-97be-61c1a8602f42','d78a7702-eae5-44f3-bb11-18b5f843b4d5','e5531f86-b9c1-4a48-8021-23301d410b59');
UPDATE room_assignments SET staff_id='5c17e4bc-e948-4dc4-a8cf-37904873edeb'         WHERE id IN ('113fc9a4-ab88-4aa0-a28c-279b75005926','539e4dea-99bd-4ab0-bb07-d0bd4648b439','5979b7c0-978b-4120-a6e7-76a720169385','adbfd7a0-9bcd-4b12-a8e1-f5a0e4df6e9d','b01070dc-47f7-41b5-b492-7157703806a9','ec933430-d859-493c-b27a-408c826fa863','ee588ab1-3163-4ae3-8a22-aef502d6baa7','f95eaf8d-91bf-4f5c-964e-8d0e64ff10c5');
-- customers: 재귀속 0건 (원상 불요)
-- CANON active 원상: true → false
UPDATE staff SET active=false WHERE id='5fb3e3b1-1c5a-461b-9159-c330a52feb95';
-- DUP active/name 원상: false → true, 중복정리 마킹 제거
UPDATE staff SET active=true, name=regexp_replace(name,' \[중복정리 2026-07-18\]$','') WHERE id='5c17e4bc-e948-4dc4-a8cf-37904873edeb';
-- 검증: 롤백 후 상태 확인 후 COMMIT/ROLLBACK 결정
-- SELECT id,name,active,user_id FROM staff WHERE name LIKE '박소예%';
COMMIT;
