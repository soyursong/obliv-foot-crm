-- T-20260609-foot-DUMMY-RESV-TESTDATA 롤백 (전량 회수)
-- 식별 마커 기반 단일 DELETE. clinic_id = jongno-foot(오리진) = 74967aea-a60b-4da3-a0e7-9c997a930bc8
DELETE FROM reservations
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND created_by = 'test-dummy-20260609';
