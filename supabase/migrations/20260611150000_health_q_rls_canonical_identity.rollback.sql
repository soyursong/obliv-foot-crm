-- ROLLBACK: T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE
-- 20260611150000_health_q_rls_canonical_identity.sql 원복.
-- health_q_results / health_q_tokens SELECT 정책을 변경 직전 상태
-- (20260529000000_health_q_mobile.sql 원본: staff.user_id = auth.uid() 패턴)로 복구.
--
-- ⚠ 이 롤백은 RC 였던 비정규 패턴을 되돌리는 것이므로, 적용 시 coordinator 0건 버그가
--   재발한다. 회귀/사고 시 긴급 원복 용도로만 사용.

BEGIN;

-- health_q_results SELECT 원복 (원본: clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid()))
DROP POLICY IF EXISTS hq_results_staff_select ON health_q_results;
CREATE POLICY "hq_results_staff_select" ON health_q_results
  FOR SELECT USING (
    clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid())
  );

-- health_q_tokens SELECT 원복
DROP POLICY IF EXISTS hq_tokens_staff_select ON health_q_tokens;
CREATE POLICY "hq_tokens_staff_select" ON health_q_tokens
  FOR SELECT USING (
    clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid())
  );

COMMIT;
