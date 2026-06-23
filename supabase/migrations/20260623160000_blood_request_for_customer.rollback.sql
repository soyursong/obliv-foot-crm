-- ROLLBACK: T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION
-- request_blood_test_for_customer RPC 제거. 테이블/컬럼 무변경이므로 데이터 영향 없음.
--   주의: 본 RPC 로 신규 생성된 피검사 요청 행(check_in_services, blood_test_requested=true, price=0)은
--   롤백으로 삭제되지 않음(데이터 보존). 필요 시 수동 정리(아래 참조 쿼리).
--
-- 참조(수동 정리용, 실행 안 함):
--   SELECT cis.* FROM check_in_services cis
--    WHERE cis.blood_test_requested = true AND cis.price = 0
--      AND cis.service_name = '혈액검사(피검사)' AND cis.service_id IS NULL;

BEGIN;

DROP FUNCTION IF EXISTS request_blood_test_for_customer(uuid, boolean);

COMMIT;
