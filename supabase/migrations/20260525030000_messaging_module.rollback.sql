-- ============================================================
-- ROLLBACK: T-20260525-foot-MESSAGING-V1 메시징 모듈 1차
-- 대상 마이그: 20260525030000_messaging_module.sql
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-05-25
-- ============================================================
-- 경고: 이 스크립트는 notification_logs 를 포함한 모든 메시징 데이터를
--       삭제합니다. 운영 환경 적용 전 반드시 데이터 백업을 수행하세요.
--
-- 실행 방법:
--   psql -f 20260525030000_messaging_module.rollback.sql
--   또는 Supabase Dashboard > SQL Editor 에서 실행
-- ============================================================

BEGIN;

-- ============================================================
-- STEP 1: pg_cron 작업 해제
-- ============================================================

SELECT cron.unschedule(jobname)
  FROM cron.job
 WHERE jobname IN (
   'foot-notif-reminder-d1',
   'foot-notif-reminder-morning',
   'foot-notif-retry-failed',
   'foot-ef-send-notification-keep-warm'
 );

-- ============================================================
-- STEP 2: 트리거 제거
-- ============================================================

DROP TRIGGER IF EXISTS reservations_messaging_trigger ON public.reservations;

-- ============================================================
-- STEP 3: 함수 제거 (의존성 역순)
-- ============================================================

-- 트리거 함수
DROP FUNCTION IF EXISTS public.notify_reservation_messaging() CASCADE;

-- 배치/재시도 함수
DROP FUNCTION IF EXISTS public.notify_retry_failed(BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS public.notify_reminders_batch(TEXT, BOOLEAN) CASCADE;

-- keep-warm 함수
DROP FUNCTION IF EXISTS public.keep_warm_send_notification() CASCADE;

-- Solapi 검증 함수
DROP FUNCTION IF EXISTS public.validate_solapi_sender(UUID) CASCADE;

-- 메시징 설정 저장 함수 (v2 시그니처: UUID, TEXT, BOOLEAN, TEXT, TEXT)
DROP FUNCTION IF EXISTS public.admin_save_messaging_config(UUID, TEXT, BOOLEAN, TEXT, TEXT) CASCADE;

-- vault secret 조회 함수
DROP FUNCTION IF EXISTS public.get_vault_secret(TEXT) CASCADE;

-- moddatetime 트리거 함수 (messaging 전용)
DROP FUNCTION IF EXISTS public.moddatetime_updated_at() CASCADE;

-- 헬퍼 alias 함수
DROP FUNCTION IF EXISTS public.get_user_clinic_id() CASCADE;
DROP FUNCTION IF EXISTS public.get_user_role() CASCADE;

-- ============================================================
-- STEP 4: customers.sms_opt_in 컬럼 제거
-- ============================================================

ALTER TABLE public.customers
  DROP COLUMN IF EXISTS sms_opt_in;

-- ============================================================
-- STEP 5: RLS 정책 제거 (테이블 DROP 전에 명시적 제거)
-- ============================================================

-- notification_opt_outs
DROP POLICY IF EXISTS notif_optout_write  ON public.notification_opt_outs;
DROP POLICY IF EXISTS notif_optout_select ON public.notification_opt_outs;

-- notification_logs
DROP POLICY IF EXISTS notif_logs_select ON public.notification_logs;

-- notification_templates
DROP POLICY IF EXISTS notif_tmpl_write  ON public.notification_templates;
DROP POLICY IF EXISTS notif_tmpl_select ON public.notification_templates;

-- clinic_messaging_capability
DROP POLICY IF EXISTS notif_cap_write  ON public.clinic_messaging_capability;
DROP POLICY IF EXISTS notif_cap_select ON public.clinic_messaging_capability;

-- ============================================================
-- STEP 6: 테이블 제거 (의존성 역순)
-- ============================================================

-- 로그 테이블 (외래키 참조 없음)
DROP TABLE IF EXISTS public.notification_opt_outs CASCADE;
DROP TABLE IF EXISTS public.notification_logs      CASCADE;
DROP TABLE IF EXISTS public.notification_templates CASCADE;

-- capability 테이블 (clinic_messaging_capability 는 다른 테이블에서 참조하지 않음)
DROP TABLE IF EXISTS public.clinic_messaging_capability CASCADE;

-- ============================================================
-- STEP 7: vault.secrets 정리 (선택적 — 키가 남아도 무해하지만 정리 권장)
-- ============================================================
-- 주의: vault.secrets 에서 삭제 시 복구 불가. 필요 시 주석 해제 후 실행.
--
-- DELETE FROM vault.secrets
--  WHERE name SIMILAR TO '(solapi_api_key_|solapi_secret_)%';

COMMIT;

-- ============================================================
-- 롤백 후 확인 쿼리
-- ============================================================
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public'
--    AND table_name IN (
--      'clinic_messaging_capability',
--      'notification_templates',
--      'notification_logs',
--      'notification_opt_outs'
--    );
-- → 0개 행 반환되어야 함
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'customers' AND column_name = 'sms_opt_in';
-- → 0개 행 반환되어야 함
--
-- SELECT jobname FROM cron.job WHERE jobname LIKE 'foot-notif-%' OR jobname LIKE 'foot-ef-%';
-- → 0개 행 반환되어야 함
--
-- SELECT trigger_name FROM information_schema.triggers
--  WHERE event_object_table = 'reservations'
--    AND trigger_name = 'reservations_messaging_trigger';
-- → 0개 행 반환되어야 함
-- ============================================================
