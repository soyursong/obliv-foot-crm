-- ROLLBACK: T-20260629-foot-FOOTDIRECT-CAL-READ-SURFACE (AC-8)
--   신규 함수·access_log 테이블·grant 전부 DROP. 기존 reservations 스키마 무변경(애초 미변경).
--   ADDITIVE-only 였으므로 역적용 시 데이터/스키마 잔존 0.

DROP FUNCTION IF EXISTS public.foot_calendar_read_direct(text, date, date, text, integer);
DROP TABLE IF EXISTS public.foot_calendar_read_access_log;
