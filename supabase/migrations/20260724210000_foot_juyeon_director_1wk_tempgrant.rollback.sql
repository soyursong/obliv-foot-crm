-- ROLLBACK / 조기 원복 — T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS
--
-- 용도 2가지:
--   (1) 총괄 조기 원복 요청(가드 #3) → 즉시 director→admin 복귀 + 스케줄 해지.
--   (2) 마이그 자체 되돌리기(abort) → 함수/잡 제거 + role 원복.
--
-- 원복 대상(원래 role) = 'admin' (2026-07-24 prod 실측 백업 기준. manager 아님 — 강등 금지).
-- idempotent: 이미 admin 이면 role UPDATE 는 0행(no-op). 잡/함수 미존재 시 각 단계 no-op.

BEGIN;

-- 1) lifecycle 잡 해지 (추가 부여/원복 폴링 중단)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-juyeon-tempgrant-lifecycle') THEN
    PERFORM cron.unschedule('foot-juyeon-tempgrant-lifecycle');
  END IF;
END $$;

-- 2) 즉시 원복: director → admin (원래 role). 이미 admin 이면 no-op.
UPDATE public.user_profiles
   SET role = 'admin', updated_at = now()
 WHERE id = 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12'
   AND role = 'director';

-- 3) tick 함수 제거
DROP FUNCTION IF EXISTS public.foot_juyeon_tempgrant_tick(timestamptz);

COMMIT;

-- 검증: role='admin' 이어야
--   SELECT id, name, role, updated_at FROM public.user_profiles WHERE id='ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';
--   SELECT jobname FROM cron.job WHERE jobname='foot-juyeon-tempgrant-lifecycle';  -- 0행이어야
