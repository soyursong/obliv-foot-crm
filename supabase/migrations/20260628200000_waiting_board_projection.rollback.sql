-- ROLLBACK for 20260628200000_waiting_board_projection.sql
-- T-20260628-foot-WAITING-REALTIME — sanitized projection 역연산.
-- ★ 자동 적용 안 됨(*.rollback.sql = 마이그 러너 제외). supervisor 게이트 후 수동 실행.
-- 완전 가역(§16-3a): 신규 객체만 제거, base check_ins 무접촉, 데이터 변이 0.
-- 주의: base REVOKE(check_ins) 는 본 트랙에 미포함이므로 GRANT 복원 라인 불필요
--   (REVOKE 가 별도 sub-gate #2 에서 적용되면 그 마이그의 rollback 이 GRANT 복원 책임).

BEGIN;

-- Realtime publication 에서 제거
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'waiting_board'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.waiting_board;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_sync_waiting_board ON public.check_ins;
DROP FUNCTION IF EXISTS public.sync_waiting_board();
DROP TABLE IF EXISTS public.waiting_board CASCADE;
DROP FUNCTION IF EXISTS public.mask_display_name(text);

COMMIT;
