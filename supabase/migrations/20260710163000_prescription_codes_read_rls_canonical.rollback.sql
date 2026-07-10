-- ROLLBACK: T-20260617-foot-RXCODES-READ-TIGHTEN
-- 20260710163000_prescription_codes_read_rls_canonical.sql 원복.
--
-- ⚠ 적용 시 prescription_codes READ 가 다시 과개방(roles={public} USING(true)) 으로 복귀 = 보안 느슨 재발.
--   긴급 회복용만 — 정당 조회자 silent DENY 등 예기치 못한 READ 차단이 라이브에서 확인될 때.
--
-- 라이브 원상태(본 마이그 적용 직전):
--   prescription_codes_read_all [SELECT] roles={public} USING(true)   ← 이 정책을 복원
--   prescription_codes_admin_all [ALL] is_admin_or_manager()          ← forward 에서 미접촉 → 원복 대상 아님(그대로 존재)
--
-- 멱등: DROP POLICY IF EXISTS. 데이터 무변경(정책 메타만).

BEGIN;

-- canonical approved_read 제거
DROP POLICY IF EXISTS prescription_codes_approved_read ON prescription_codes;

-- 원상태 read_all 재생성 (roles={public} = TO 절 없음 → PUBLIC, USING(true))
DROP POLICY IF EXISTS prescription_codes_read_all ON prescription_codes;  -- 멱등 가드
CREATE POLICY prescription_codes_read_all ON prescription_codes
  FOR SELECT
  USING (true);

-- prescription_codes_admin_all [ALL] 은 forward 마이그에서 미접촉 → 원복 불필요(그대로 존재).

COMMIT;

-- 검증 쿼리 (rollback 후 확인용):
--   SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--     WHERE schemaname='public' AND tablename='prescription_codes' ORDER BY cmd, policyname;
--   → prescription_codes_read_all  [SELECT] roles={public} USING(true)   (복원)
--   → prescription_codes_admin_all [ALL]    is_admin_or_manager()        (불변)
--   → prescription_codes_approved_read 부재
