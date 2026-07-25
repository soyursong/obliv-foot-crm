-- ROLLBACK: T-20260725-foot-INSURANCE-GRADE-SECDEF-RPC
--
-- 신규 SECDEF RPC 제거 → 클라이언트 경로(updateInsuranceGrade)는 코드 revert 로 .update 직접경로 복귀.
-- ADDITIVE 신설 함수만 제거하므로 기존 스키마/RLS/데이터 무영향.
--
-- ⚠️ 순서: 클라이언트 배포 revert(rpc 호출 → .update 복귀) 를 먼저 하거나 동시에.
--   함수만 먼저 DROP 하면 클라가 rpc 호출 시 함수 부재 에러 → 등급 편집 일시 불가(사일런트 아님, 명시적 실패).

DROP FUNCTION IF EXISTS update_insurance_grade(UUID, TEXT, TEXT, TEXT);
