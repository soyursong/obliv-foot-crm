-- T-20260630-foot-PROGRESS-DUMMY-SEED 원복 (현장 테스트 종료 후 1발 실행)
-- prod: rxlomoozakkjesdqjtvd (obliv-foot-crm) / jongno-foot
-- 스코프: 본 티켓이 INSERT한 reservations 4행만. customers/check_ins/medical_charts 무영향(미생성).
-- 실데이터 무영향(memo MARKER + is_simulation 더미고객 링크 한정).

-- 방법 A: id 명시(가장 안전)
DELETE FROM reservations
WHERE id IN (
  '89dd247d-1bed-4f5e-a4cd-9bb9a33669b0',  -- 테스트경과01 | 6회 경과분석
  '8d9ee9ad-b8ef-495f-aa6b-799dcfd79a74',  -- 테스트경과02 | 12회 경과분석
  'd063cba1-90ad-49f1-9a69-113a791f7a78',  -- 테스트경과03 | 18회 경과분석
  '78f64a7c-a0c5-4cd2-b94a-d8a0c5bb76bc'   -- 테스트경과분석 | 24회 경과분석
);

-- 방법 B: MARKER 스코프(동등, 멱등)
-- DELETE FROM reservations
-- WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
--   AND memo = '[TEST-DUMMY PROGRESS-SEED 20260630]';
