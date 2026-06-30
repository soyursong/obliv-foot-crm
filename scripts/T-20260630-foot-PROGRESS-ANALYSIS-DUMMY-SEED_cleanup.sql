-- ============================================================
-- T-20260630-foot-PROGRESS-ANALYSIS-DUMMY-SEED — CLEANUP (정리 SQL 1발)
-- 현장(김주연 총괄) '경과분석 발행' 테스트 종료 후 더미 일괄삭제.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm) / clinic: jongno-foot
-- 안전: is_simulation=true + 정확한 MARKER memo 로만 스코프 → 실데이터 절대 비대상.
--       자식행(FK) 먼저 삭제 → 고객 삭제. 단일 트랜잭션(부분실패 시 전체 롤백).
-- 선례: T-20260514-foot-TESTDATA-CLEANUP 패턴.
--
-- ⚠ 주의(의료법 불변): 테스트 중 '소견서/진료서류 발행'(form_submissions.status='published')이
--   생성됐다면 의료법상 불변(trg_form_submissions_published_immutable)이라 본 SQL 의 customers DELETE 가
--   FK 로 막힐 수 있음. 그 경우 supervisor 권한 처리 필요(선례 T-20260629-foot-OPINIONDOC-DRAFT-MIXED-CLEANUP).
--   참고: 현장 발행자(총괄)는 의사권한(director/doctor) 아니므로 소견서 발행 게이트에 막혀 published 행 생성 가능성 낮음.
-- ============================================================

BEGIN;

-- 0) 대상 고객 id 확인용(실행 전 점검 권장):
--    SELECT id, name, phone FROM customers
--    WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
--      AND is_simulation=true AND memo='[TEST-DUMMY 경과분석발행 20260701]';

-- 1) 자식행 삭제 (FK 순서)
DELETE FROM medical_charts
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
    AND is_simulation=true AND memo='[TEST-DUMMY 경과분석발행 20260701]'
);

DELETE FROM check_ins
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
    AND is_simulation=true AND memo='[TEST-DUMMY 경과분석발행 20260701]'
);

DELETE FROM reservations
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
    AND is_simulation=true AND memo='[TEST-DUMMY 경과분석발행 20260701]'
);

-- (draft 서류만 안전 삭제 — published 는 의료법 불변이라 미대상)
DELETE FROM form_submissions
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
    AND is_simulation=true AND memo='[TEST-DUMMY 경과분석발행 20260701]'
) AND status <> 'published';

-- 2) 고객 삭제
DELETE FROM customers
WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND is_simulation=true AND memo='[TEST-DUMMY 경과분석발행 20260701]';

COMMIT;

-- 검증: 0건이어야 함
-- SELECT count(*) FROM customers WHERE is_simulation=true AND memo='[TEST-DUMMY 경과분석발행 20260701]';
