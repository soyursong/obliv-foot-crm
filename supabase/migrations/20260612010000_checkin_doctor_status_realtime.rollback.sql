-- ROLLBACK — T-20260611-foot-DOCTORCALL-SORT-INTREATMENT-BADGE WS-2
-- 20260612010000_checkin_doctor_status_realtime.sql 역적용.
-- 무손실: 컬럼 3개 + CHECK constraint 제거(데이터는 진료 세션 표지뿐 — 환자 식별/임상 본문 없음).
-- 적용 전이면 no-op (IF EXISTS 가드).

ALTER TABLE public.check_ins DROP CONSTRAINT IF EXISTS check_ins_doctor_status_chk;
ALTER TABLE public.check_ins DROP COLUMN IF EXISTS doctor_ended_at;
ALTER TABLE public.check_ins DROP COLUMN IF EXISTS doctor_started_at;
ALTER TABLE public.check_ins DROP COLUMN IF EXISTS doctor_status;
