-- attendance-sync 주기 디스패치 (pg_cron → attendance-sync EF)
-- T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM (AC-3)
--
-- ── 순서 ──────────────────────────────────────────────────────────
--   ⚠ 반드시 20260618200000_staff_attendance_ssot.sql(테이블 신설) apply 후 적용.
--     이 마이그는 테이블을 채우는 sync worker(cron)만 등록한다(테이블 자체 무접촉).
--
-- ── 역할 ──────────────────────────────────────────────────────────
--   attendance-sync EF 를 net.http_post 로 호출 → 구글시트 근무캘린더를 read 해
--   staff_attendance 로 reconcile-upsert. '매일/변경시' 요건 = 15분 주기 폴링으로 충족
--   (변경 반영 지연 ≤15분, 매일 자동 보장). reconcile 멱등 → 재실행/중복 무해.
--
--   URL/시크릿 해석은 풋 컨벤션(app.supabase_url→vault supabase_project_url,
--   app.cron_secret→vault internal_cron_secret) — dopamine outbox worker 와 동일.
--
-- ── ADDITIVE ──────────────────────────────────────────────────────
--   신규 함수 1 + cron job 1. 기존 테이블/스키마/함수 무접촉. 파괴적 변경 0.
-- Rollback: 20260618201000_attendance_sync_cron.rollback.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.trigger_attendance_sync()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ef_url      TEXT;
  v_cron_secret TEXT;
BEGIN
  -- EF base URL (풋 컨벤션)
  v_ef_url := COALESCE(
    current_setting('app.supabase_url', TRUE),
    public.get_vault_secret('supabase_project_url')
  );
  IF v_ef_url IS NULL OR v_ef_url = '' THEN
    RAISE LOG 'trigger_attendance_sync: supabase url 미설정 — skip';
    RETURN jsonb_build_object('ok', false, 'reason', 'no_url');
  END IF;
  v_ef_url := v_ef_url || '/functions/v1/attendance-sync';

  -- 내부 호출 시크릿 (풋 컨벤션)
  v_cron_secret := COALESCE(
    current_setting('app.cron_secret', TRUE),
    public.get_vault_secret('internal_cron_secret'),
    ''
  );

  PERFORM net.http_post(
    url     := v_ef_url,
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'X-Internal-Cron', v_cron_secret
    ),
    body    := jsonb_build_object('days_back', 1, 'days_forward', 14)::TEXT
  );

  RETURN jsonb_build_object(
    'ok',     true,
    'run_at', to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ')
  );
END;
$$;

COMMENT ON FUNCTION public.trigger_attendance_sync() IS
  'T-20260618-foot-STAFF-ATTENDANCE-SSOT: attendance-sync EF 호출 worker(15분 주기). '
  '구글시트 근무캘린더 → staff_attendance reconcile-upsert. 멱등.';

-- pg_cron 등록 — 15분 주기(매일/변경시 요건). 재실행 안전.
DO $$
BEGIN
  PERFORM cron.unschedule('foot-attendance-sync');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'foot-attendance-sync',
  '*/15 * * * *',   -- 매 15분 (변경 반영 지연 ≤15분 + 매일 자동 보장)
  $$ SELECT public.trigger_attendance_sync() $$
);

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECKLIST (supervisor / dev-foot)
-- ============================================================
-- [ ] 1. 선행 테이블 : SELECT to_regclass('public.staff_attendance');           -- not null
-- [ ] 2. 함수 생성   : SELECT proname FROM pg_proc WHERE proname='trigger_attendance_sync';
-- [ ] 3. cron 등록   : SELECT jobname,schedule,active FROM cron.job WHERE jobname='foot-attendance-sync';
-- [ ] 4. EF 배포     : attendance-sync EF 배포 + env(CRON_SECRET/DUTY_SHEET_ID/DUTY_SHEET_GIDS/FOOT_CLINIC_ID) 주입
-- [ ] 5. 수동 1틱    : SELECT public.trigger_attendance_sync();  → EF 200 + staff_attendance rows>0 확인
-- [ ] 6. 정합       : SELECT count(*) FROM staff_attendance WHERE date=(now() at time zone 'Asia/Seoul')::date AND status='present';
--                     ↔ 시트 라이브 '오늘 출근자' 수 대조 (AC-5)
-- ============================================================
