-- ROLLBACK: T-20260820-foot-PHOTOUP-FAILURE-TELEMETRY (되돌림)
--   신규 테이블 photo_upload_failures 를 통째로 DROP = 완전가역.
--   · 기존 테이블/컬럼/RLS/데이터 무접촉(ADDITIVE 이므로 순수 제거로 원복).
--   · 정책/인덱스/GRANT 는 테이블 DROP 에 종속 → CASCADE 로 함께 제거.
--   · ⚠ 이미 적재된 진단 로그 행(PHI-free)이 있으면 함께 소실된다(테이블 삭제이므로 의도된 동작).
--       재적용은 UP 재실행(멱등)으로 신규 테이블 재생성.
--
-- 적용: supabase db push --file supabase/migrations/20260820140000_foot_photo_upload_failures_telemetry.rollback.sql

BEGIN;

DROP TABLE IF EXISTS public.photo_upload_failures CASCADE;

-- 방어 확인: 테이블 제거 완료
DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name='photo_upload_failures') THEN
    RAISE EXCEPTION 'ROLLBACK 가드 실패: photo_upload_failures 테이블이 여전히 존재';
  END IF;
END $chk$;

NOTIFY pgrst, 'reload schema';

COMMIT;
