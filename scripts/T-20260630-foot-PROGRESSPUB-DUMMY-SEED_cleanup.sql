-- ============================================================
-- T-20260630-foot-PROGRESSPUB-DUMMY-SEED — CLEANUP (정리 SQL 1발)
-- 김주연 총괄 '경과분석 발행' 테스트 종료 후 더미 환자 일괄삭제.
-- ★canonical 스코프(2 MARKER): 본 티켓 더미 3명(테스트경과01/02/03, memo='[TEST-DUMMY PROGRESSPUB 20260701]')
--   + 선행 superseded 티켓 PROGRESS-ANALYSIS-DUMMY-SEED 잔존 단건(테스트경과분석, memo='[TEST-DUMMY 경과분석발행 20260701]')
--   → 경과분석 탭 4행 전량 1발 회수. (FIX-REQUEST MSG-20260701-003410-k9vi '참고' 반영)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm) / clinic: jongno-foot
-- 안전: is_simulation=true + 정확한 2개 MARKER memo 로만 스코프 → 실데이터 절대 비대상.
--       자식행(FK) 먼저 삭제 → 고객 삭제. 단일 트랜잭션(부분실패 시 전체 롤백).
-- 선례: T-20260630-foot-PROGRESS-ANALYSIS-DUMMY-SEED_cleanup.sql 패턴.
--
-- ⚠ 주의(의료법 불변): 테스트 중 '소견서/진료서류 발행'(form_submissions.status='published')이
--   생성됐다면 의료법상 불변(trg_form_submissions_published_immutable)이라 본 SQL 의 customers DELETE 가
--   FK 로 막힐 수 있음. 그 경우 supervisor 권한 처리 필요(선례 T-20260629-foot-OPINIONDOC-DRAFT-MIXED-CLEANUP).
--   참고: 현장 발행자(총괄)는 의사권한(director/doctor) 아니므로 published 행 생성 가능성 낮음.
-- ============================================================

BEGIN;

-- 0) 대상 고객 id 확인용(실행 전 점검 권장):
--    SELECT id, name, phone FROM customers
--    WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
--      AND is_simulation=true AND memo IN ('[TEST-DUMMY PROGRESSPUB 20260701]','[TEST-DUMMY 경과분석발행 20260701]');

-- 1) 자식행 삭제 (FK 순서)
DELETE FROM medical_charts
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
    AND is_simulation=true AND memo IN ('[TEST-DUMMY PROGRESSPUB 20260701]','[TEST-DUMMY 경과분석발행 20260701]')
);

DELETE FROM check_ins
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
    AND is_simulation=true AND memo IN ('[TEST-DUMMY PROGRESSPUB 20260701]','[TEST-DUMMY 경과분석발행 20260701]')
);

DELETE FROM reservations
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
    AND is_simulation=true AND memo IN ('[TEST-DUMMY PROGRESSPUB 20260701]','[TEST-DUMMY 경과분석발행 20260701]')
);

-- (draft 서류만 안전 삭제 — published 는 의료법 불변이라 미대상)
DELETE FROM form_submissions
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
    AND is_simulation=true AND memo IN ('[TEST-DUMMY PROGRESSPUB 20260701]','[TEST-DUMMY 경과분석발행 20260701]')
) AND status <> 'published';

-- 2) 고객 삭제
DELETE FROM customers
WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND is_simulation=true AND memo IN ('[TEST-DUMMY PROGRESSPUB 20260701]','[TEST-DUMMY 경과분석발행 20260701]');

COMMIT;

-- 검증: 0건이어야 함
-- SELECT count(*) FROM customers WHERE is_simulation=true AND memo IN ('[TEST-DUMMY PROGRESSPUB 20260701]','[TEST-DUMMY 경과분석발행 20260701]');
