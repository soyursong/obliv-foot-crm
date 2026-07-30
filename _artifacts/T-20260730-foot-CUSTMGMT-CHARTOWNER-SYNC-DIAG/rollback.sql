-- T-20260730-foot-CUSTMGMT-CHARTOWNER-SYNC-DIAG — Part 1 백필 롤백 SQL
-- 목적: 7건 assigned_staff_id NULL → 원래 김수린 staff_id 로 원복.
-- 김수린 staff_id = 5b3a3a5f-9d14-4099-897b-95c6ae86b763 (active=false, role=consultant)
-- 대상 7건 (freeze set, 진단 D4 시점 == UPDATE 직전 재검증 일치):
--   054948a2-fc42-483b-bc98-2ad1a5727395  F-0155  양종필
--   65351f78-ffee-4a4a-a25d-503c716b8b1e  F-0896  김수연
--   8ef1f602-5c89-4c50-b616-6a10695647af  F-3904  서호영
--   0e27bce7-8311-4c80-9a26-edbba0b4d9e1  F-4067  윤민희
--   362663c7-bb77-4e33-9f17-05b94b3fd866  F-4328  박세진
--   c074025b-cd27-443c-93a9-151d6d4214d4  F-4468  풋 서류 테스트 입니다
--   ca8975d4-b79c-4704-b142-3742692ce787  F-4470  김설아
-- 안전가드: 현재 assigned_staff_id 가 NULL 인 행만 원복(백필 이후 재지정된 행 보호).

UPDATE customers
SET assigned_staff_id = '5b3a3a5f-9d14-4099-897b-95c6ae86b763'
WHERE id = ANY(ARRAY[
  '054948a2-fc42-483b-bc98-2ad1a5727395',
  '65351f78-ffee-4a4a-a25d-503c716b8b1e',
  '8ef1f602-5c89-4c50-b616-6a10695647af',
  '0e27bce7-8311-4c80-9a26-edbba0b4d9e1',
  '362663c7-bb77-4e33-9f17-05b94b3fd866',
  'c074025b-cd27-443c-93a9-151d6d4214d4',
  'ca8975d4-b79c-4704-b142-3742692ce787'
]::uuid[])
  AND assigned_staff_id IS NULL;
-- 기대 영향 행수 = 7 (백필 직후 원복 시). assigned_consultant_id / payments 무접촉.
