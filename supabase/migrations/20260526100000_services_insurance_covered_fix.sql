-- T-20260526-foot-COPAY-MINI-BUG AC-1
-- services 테이블 — AA154/D6203 및 동류 급여 항목 is_insurance_covered 수정
--
-- 원인: AA-series(진찰료) + D620300HZ(KOH진균검사) 가 is_insurance_covered=false 로
--       등록되어 있어 결제 미니창 세금 구분 "급여" 행에 0 표시되는 버그 수정.
--
-- 범위: service_code 패턴으로 건강보험 급여 항목 일괄 교정
--   · AA154   초진진찰료 (의원)
--   · AA254   재진진찰료 (의원)
--   · AA155   재진진찰료
--   · AA222   재진-물리치료·주사 등 시술받은 경우
--   · AA157   의사전화상담
--   · D620300HZ  일반진균검사 KOH도말-조갑조직
--
-- risk: 데이터 수정만 (스키마 변경 없음) — LOW
-- rollback: 20260526100000_services_insurance_covered_fix.down.sql

UPDATE services
SET is_insurance_covered = true
WHERE service_code IN (
  'AA154',
  'AA254',
  'AA155',
  'AA222',
  'AA157',
  'D620300HZ'
)
AND (is_insurance_covered IS NULL OR is_insurance_covered = false);
