-- ============================================================
-- ROLLBACK — T-20260815-foot-JONGNO-OPHOURS-CHANGE-20260901
--   up(20260815000000_foot_clinic_operating_hours_gen.sql) 역전.
--   신규 테이블 1개(clinic_operating_hours) 전체 제거 = seed 6행 함께 소멸.
--   ★ADDITIVE 신규 테이블이므로 DROP 이 clean rollback. 기존 clinics flat 컬럼은 애초 무변경 → 복원 불요.
--   ★FE(schedule.ts/clinic.ts)는 테이블 부재 시 42P01 graceful → flat 3컬럼 fallback → 현행 동작 무교란(무배포 상태와 동일).
--   전제: clinic_operating_hours 는 본 티켓 신설(롱레와 별도 DB). 타 티켓이 선점하지 않음(census: origin/main 0 refs).
-- ============================================================
BEGIN;

DROP POLICY IF EXISTS clinic_operating_hours_approved_read ON public.clinic_operating_hours;
DROP POLICY IF EXISTS clinic_operating_hours_admin_all     ON public.clinic_operating_hours;
DROP INDEX  IF EXISTS public.idx_clinic_operating_hours_resolve;
DROP TABLE  IF EXISTS public.clinic_operating_hours;

COMMIT;

-- POST-ROLLBACK CHECK
-- [ ] clinic_operating_hours 테이블 부재
-- [ ] clinics 무변경(open_time/close_time/weekend_close_time 그대로)
-- [ ] FE = flat 3컬럼 fallback(현행 동작) — 배포 전과 동일
