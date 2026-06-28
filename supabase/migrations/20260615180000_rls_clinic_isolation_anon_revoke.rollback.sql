-- ROLLBACK for 20260615180000_rls_clinic_isolation_anon_revoke.sql (Phase 2b)
-- T-20260627-foot-ANON-RLS-PHASE2B — AC3 (롤백 SQL 준비).
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠ EMERGENCY SERVICE-RESTORE ONLY. 이 스크립트는 2b revoke 적용 후 라이브 회귀
--   (셀프체크인 키오스크/대기 현황판 깨짐)가 관측될 때, 알려진-정상(pre-2b) 상태로
--   되돌리기 위한 수동 롤백이다. 실행 시 anon read 표면이 다시 열린다(= 차단 해제) →
--   서비스 복구 후 즉시 forward 재수정(완전 컷오버 후 2b 재적용)으로 닫을 것.
-- ★ 자동 적용 안 됨(*.rollback.sql = 마이그 러너 제외). supervisor DDL-diff 게이트 후 수동 실행.
-- ════════════════════════════════════════════════════════════════════════════
-- 복원 대상(forward 2b 의 정확한 역연산):
--   forward: DROP POLICY ×3 + REVOKE SELECT ×3 + REVOKE ALL ON payments
--   inverse: GRANT SELECT ×3 + CREATE POLICY ×3 (원본 USING 절) + GRANT payments
-- 원본 정의 출처:
--   anon_reservation_read / anon_checkin_read = USING(true)  (20260504000010_anon_selfcheckin_rls_fix.sql)
--   anon_select_customer_self_checkin = USING(clinic_id IS NOT NULL) (20260426030000_anon_self_checkin_policies.sql)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) anon SELECT 권한 복원 (forward 의 REVOKE SELECT 역연산)
GRANT SELECT ON public.customers    TO anon;
GRANT SELECT ON public.check_ins    TO anon;
GRANT SELECT ON public.reservations TO anon;

-- payments: forward 의 REVOKE ALL 역연산. RLS(canonical)가 anon row 0건 게이트 유지하므로
--   table-GRANT 복원만으로 row 노출 없음. 알려진-정상 상태로의 완전 복원을 위해 동봉.
GRANT SELECT ON public.payments TO anon;

-- 2) anon SELECT 정책 복원 (forward 의 DROP POLICY 역연산, 원본 USING 절 그대로)
DROP POLICY IF EXISTS anon_select_customer_self_checkin ON public.customers;
CREATE POLICY anon_select_customer_self_checkin ON public.customers
  FOR SELECT TO anon
  USING (clinic_id IS NOT NULL);

DROP POLICY IF EXISTS anon_checkin_read ON public.check_ins;
CREATE POLICY anon_checkin_read ON public.check_ins
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS anon_reservation_read ON public.reservations;
CREATE POLICY anon_reservation_read ON public.reservations
  FOR SELECT TO anon
  USING (true);

COMMIT;
