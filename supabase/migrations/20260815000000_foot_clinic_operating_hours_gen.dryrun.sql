-- DRY-RUN (No-Persistence) — T-20260815-foot-JONGNO-OPHOURS-CHANGE-20260901
--   20260815000000_..._gen.sql 의 DDL(CREATE TABLE + index + RLS)·seed 로직을 그대로 실행하되 COMMIT 대신 ROLLBACK.
--   would-INSERT ROW_COUNT 를 실제로 계측·검증하되 영속시키지 않는다(migration_dryrun_no_persistence 준수).
--   ADDITIVE(신규 테이블·seed 6행). 파괴/UPDATE/DELETE 없음. 멱등·row-absent(일요일 미삽입) 검증.
--   기대: 최초 would-INSERT=6(월~토). 일요일(dow 0)=미삽입. 재실행(세대 존재) 시 스킵.
-- =========================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.clinic_operating_hours (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID        NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  day_of_week       SMALLINT    NOT NULL,
  open_time         TIME        NOT NULL,
  close_time        TIME        NOT NULL,
  last_booking_slot TIME        NOT NULL,
  effective_from    DATE        NOT NULL,
  effective_to      DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clinic_operating_hours_dow_chk        CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT clinic_operating_hours_slot_bound_chk CHECK (last_booking_slot <= close_time),
  CONSTRAINT clinic_operating_hours_uq             UNIQUE (clinic_id, day_of_week, effective_from)
);

DO $$
DECLARE
  v_clinic_id UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  v_ef        DATE := DATE '2026-09-01';
  v_inserted  int;
  v_sun       int;
BEGIN
  INSERT INTO public.clinic_operating_hours
    (clinic_id, day_of_week, open_time, close_time, last_booking_slot, effective_from, effective_to)
  SELECT v_clinic_id, d.dow, d.o, d.c, d.l, v_ef, NULL
  FROM (VALUES
    (1, TIME '09:00', TIME '20:00', TIME '19:00'),
    (2, TIME '09:00', TIME '20:00', TIME '19:00'),
    (3, TIME '09:00', TIME '20:00', TIME '19:00'),
    (4, TIME '09:00', TIME '20:00', TIME '19:00'),
    (5, TIME '09:00', TIME '20:00', TIME '19:00'),
    (6, TIME '09:00', TIME '19:00', TIME '18:00')
  ) AS d(dow, o, c, l)
  ON CONFLICT (clinic_id, day_of_week, effective_from) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE '[DRY-RUN] would-INSERT ROW_COUNT=% (기대=6, 월~토)', v_inserted;

  SELECT count(*) INTO v_sun FROM public.clinic_operating_hours
   WHERE clinic_id = v_clinic_id AND effective_from = v_ef AND day_of_week = 0;
  RAISE NOTICE '[DRY-RUN] 일요일(dow 0) 행수=% (기대=0, 휴무 row-absent)', v_sun;

  IF v_inserted <> 6 THEN
    RAISE EXCEPTION '[DRY-RUN] would-INSERT=% (기대 6) — abort', v_inserted;
  END IF;
  IF v_sun <> 0 THEN
    RAISE EXCEPTION '[DRY-RUN] 일요일 행 존재(% 행) — 휴무 row-absent 위반, abort', v_sun;
  END IF;
END $$;

-- 무영속: 실제 배포는 .sql 이 담당(GO-token 후). dry-run 은 검증만.
ROLLBACK;
