-- ROLLBACK: T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION
-- request_blood_test_for_customer RPC 제거 + 본 RPC 가 신규 생성한 피검사 요청 placeholder 행 정리.
--   KOH 롤백 패턴 미러(supervisor DDL-diff 요구) — 단독신청으로 자동 INSERT 된 마커 행은
--   RPC 제거 후 무의미(생성 경로 소멸) → 롤백 시 함께 cleanup.
--
-- cleanup 범위(forward INSERT 마커와 1:1 일치, 안전 격리):
--   blood_test_requested=true AND price=0 AND service_name='혈액검사(피검사)' AND service_id IS NULL
--   → 본 RPC 의 ② 분기(서비스행없음+ON) 가 만든 placeholder 행만 삭제.
--   ① 동기화 분기로 blood_test_requested=true 가 된 '실제 서비스 행'(service_id 보유/카탈로그 연결)은
--      service_id IS NULL 조건으로 제외 → 회귀 0, 정상 시술/매출 행 보존.

BEGIN;

-- ① placeholder 행 cleanup (forward ② 분기 자동생성분 한정)
DELETE FROM check_in_services
 WHERE blood_test_requested = true
   AND price = 0
   AND service_name = '혈액검사(피검사)'
   AND service_id IS NULL;

-- ② RPC 제거
DROP FUNCTION IF EXISTS request_blood_test_for_customer(uuid, boolean);

COMMIT;
