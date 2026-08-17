-- DRY-RUN (No-Persistence) — T-20260817-foot-RESVSLOT-OPHOURS-0930
--   20260817130000_..._start.sql 의 UPDATE 로직을 그대로 실행하되 COMMIT 대신 ROLLBACK.
--   would-UPDATE ROW_COUNT 를 실제로 계측·검증하되 영속시키지 않는다(migration_dryrun_no_persistence 준수).
--   data-only UPDATE(open_time 09:00→09:30, dow 1~6). DDL/신규컬럼/DELETE 없음. 일요일 무접촉 검증.
--   기대: 최초 would-UPDATE=6(월~토). 일요일(dow 0)=무접촉(0행 유지). 마지막슬롯 불변.
-- =========================================================================
BEGIN;

DO $$
DECLARE
  v_clinic_id UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  v_ef        DATE := DATE '2026-09-01';
  v_slug      TEXT;
  v_updated   int;
  v_wd_ok     int;
  v_sun       int;
BEGIN
  SELECT slug INTO v_slug FROM public.clinics WHERE id = v_clinic_id;
  IF v_slug IS DISTINCT FROM 'jongno-foot' THEN
    RAISE EXCEPTION '[DRY-RUN] clinic_id % slug=% (expected jongno-foot) — abort', v_clinic_id, v_slug;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.clinic_operating_hours
    WHERE clinic_id = v_clinic_id AND effective_from = v_ef AND day_of_week BETWEEN 1 AND 6
  ) THEN
    RAISE EXCEPTION '[DRY-RUN] 09-01 세대행(dow 1~6) 부재 — 08-15 배포 전제 미충족, abort';
  END IF;

  UPDATE public.clinic_operating_hours
     SET open_time = TIME '09:30'
   WHERE clinic_id      = v_clinic_id
     AND effective_from = v_ef
     AND day_of_week BETWEEN 1 AND 6
     AND open_time <> TIME '09:30';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '[DRY-RUN] would-UPDATE ROW_COUNT=% (기대=6, 월~토 최초)', v_updated;

  SELECT count(*) INTO v_wd_ok FROM public.clinic_operating_hours
   WHERE clinic_id = v_clinic_id AND effective_from = v_ef
     AND day_of_week BETWEEN 1 AND 6 AND open_time = TIME '09:30';
  RAISE NOTICE '[DRY-RUN] 09:30 착지(dow 1~6) 행수=% (기대=6)', v_wd_ok;

  SELECT count(*) INTO v_sun FROM public.clinic_operating_hours
   WHERE clinic_id = v_clinic_id AND effective_from = v_ef AND day_of_week = 0;
  RAISE NOTICE '[DRY-RUN] 일요일(dow 0) 행수=% (기대=0, 휴무 row-absent 무접촉)', v_sun;

  IF v_wd_ok <> 6 THEN
    RAISE EXCEPTION '[DRY-RUN] 09:30 착지=% (기대 6) — abort', v_wd_ok;
  END IF;
  IF v_sun <> 0 THEN
    RAISE EXCEPTION '[DRY-RUN] 일요일 행 존재(% 행) — 휴무 row-absent 위반, abort', v_sun;
  END IF;
END $$;

-- 무영속: 실제 배포는 .sql 이 담당(GO-token 후). dry-run 은 검증만.
ROLLBACK;
