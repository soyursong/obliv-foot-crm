-- ROLLBACK for 20260703160000_anon_reservation_read_scopedown_today_confirmed.sql
-- T-20260703-foot-JONGNO-ANON-PHI-INTERIM-SCOPEDOWN — Track 1 scope-down 역연산.
-- DA spec §1.2 rollback 페어.
-- ★ 자동 적용 안 됨(*.rollback.sql = 마이그 러너 제외). emergency-restore 전용, supervisor 수동 실행.
-- 용도: anon 표면 재개방(USING true 복원) → 이후 forward 재컷오버로 다시 닫음.
--   ⚠ 복원 시 전이력·전지점 dump 벡터가 되살아나므로 긴급상황에서만 사용.

BEGIN;

DROP POLICY IF EXISTS anon_reservation_read ON public.reservations;

CREATE POLICY anon_reservation_read ON public.reservations
  FOR SELECT TO anon
  USING (true);

COMMIT;
