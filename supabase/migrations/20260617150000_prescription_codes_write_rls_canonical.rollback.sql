-- ROLLBACK: T-20260617-foot-RXCODES-WRITE-RLS-CANONICAL
-- 20260617150000_prescription_codes_write_rls_canonical.sql 원복.
--
-- ⚠ 적용 시 prescription_codes write GAP 재발 — 긴급 회복용만.
--   prescription_codes 의 라이브 원상태는 write 정책 부재(read_all[SELECT true] 단 1개)였다.
--   form_templates(20260612 rollback)와 달리 복원할 구 write 정책이 없으므로,
--   canonical admin_all 를 제거하면 곧바로 원상태(authenticated INSERT/UPDATE/DELETE 전부 RLS silent DENY)로 복귀.
--   → 적용 시 InsuranceStatusTab insurance_status 수동갱신 + 이관약 검증 UPDATE 가 다시 silent 차단된다.
--
-- READ(prescription_codes_read_all [SELECT] USING(true))는 forward 마이그에서 미접촉 → 원복 대상 아님(그대로 존재).
-- 멱등: DROP POLICY IF EXISTS. 데이터 무변경(정책 메타만).

BEGIN;

-- canonical write 정책 제거 → 원상태(write 정책 부재 = silent DENY)로 복귀
DROP POLICY IF EXISTS prescription_codes_admin_all ON prescription_codes;

-- prescription_codes_read_all [SELECT] USING(true) 는 본 티켓에서 미접촉 → 원복 불필요(그대로 존재).

COMMIT;

-- 검증 쿼리 (rollback 후 확인용):
--   SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--     WHERE schemaname='public' AND tablename='prescription_codes' ORDER BY cmd, policyname;
--   → prescription_codes_read_all [SELECT] USING true  (단 1개만 남음 = 원상태)
--   → prescription_codes_admin_all 부재
