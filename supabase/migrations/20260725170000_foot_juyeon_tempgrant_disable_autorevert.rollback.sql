-- ROLLBACK — T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS (A안 자동원복 해제 되돌리기)
--
-- 용도: 본 마이그(20260725170000)를 되돌려 선행(20260724210000) 자동원복 동작으로 복원.
--   - foot_juyeon_tempgrant_tick 을 8/1 자동원복 브랜치 포함 원형으로 CREATE OR REPLACE.
--   - on-request 원복 함수 foot_juyeon_tempgrant_revert() DROP.
--   - cron 스케줄 복원(동일 */15, tick 폴).
--   - 대상 role 은 변경하지 않음(director 라이브 유지) — 복원된 tick 이 시각 기준으로 처리.
--
-- baseline='admin' 정본은 복원되는 tick 의 v_orig_role='admin' 상수로 그대로 유지된다.
-- idempotent: 함수 미존재/잡 미존재 시 각 단계 no-op.

BEGIN;

-- 1) on-request 원복 함수 제거
DROP FUNCTION IF EXISTS public.foot_juyeon_tempgrant_revert();

-- 2) tick 함수를 선행(20260724210000) 자동원복 원형으로 복원
CREATE OR REPLACE FUNCTION public.foot_juyeon_tempgrant_tick(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $fn$
DECLARE
  v_id        uuid        := 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';
  v_grant_at  timestamptz := '2026-07-24 15:00:00+00';   -- 2026-07-25 00:00 KST 발효
  v_revert_at timestamptz := '2026-07-31 15:00:00+00';   -- 2026-08-01 00:00 KST 자동원복
  v_orig_role text        := 'admin';
  v_temp_role text        := 'director';
  v_changed   int         := 0;
  v_action    text        := 'noop';
BEGIN
  IF p_now >= v_revert_at THEN
    UPDATE public.user_profiles
       SET role = v_orig_role, updated_at = now()
     WHERE id = v_id AND role = v_temp_role;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    v_action := 'revert';
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-juyeon-tempgrant-lifecycle') THEN
      PERFORM cron.unschedule('foot-juyeon-tempgrant-lifecycle');
    END IF;
    RAISE LOG 'foot-juyeon-tempgrant: REVERT director->admin (rows=%) at %', v_changed, p_now;
  ELSIF p_now >= v_grant_at THEN
    UPDATE public.user_profiles
       SET role = v_temp_role, updated_at = now()
     WHERE id = v_id AND role = v_orig_role;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    v_action := 'grant';
    IF v_changed > 0 THEN
      RAISE LOG 'foot-juyeon-tempgrant: GRANT admin->director (rows=%) at %', v_changed, p_now;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'action', v_action, 'rows', v_changed, 'p_now', p_now,
    'grant_at', v_grant_at, 'revert_at', v_revert_at, 'target', v_id
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.foot_juyeon_tempgrant_tick(timestamptz) FROM PUBLIC;

-- 3) cron 스케줄 복원(동일 */15)
SELECT cron.schedule(
  'foot-juyeon-tempgrant-lifecycle',
  '*/15 * * * *',
  $$SELECT public.foot_juyeon_tempgrant_tick();$$
);

COMMIT;

-- 검증: tick 정의에 자동원복 브랜치(p_now >= v_revert_at) 존재 / revert 함수 부재
--   SELECT prosrc FROM pg_proc WHERE proname='foot_juyeon_tempgrant_tick';
--   SELECT NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname='foot_juyeon_tempgrant_revert') AS revert_fn_absent;
