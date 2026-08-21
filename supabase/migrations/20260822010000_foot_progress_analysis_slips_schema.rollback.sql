-- ============================================================
-- ROLLBACK — T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE Phase-2 §4/§5 (DA-20260822-SLIP-SCHEMA)
-- ============================================================
-- 대응 forward: 20260822010000_foot_progress_analysis_slips_schema.sql
-- ⚠️ 파괴적: 신규 테이블 2 + additive 컬럼 5 제거. slips/audit_log 데이터 유실 → apply 前 백업 필수(supervisor GO-token 게이트).
--    progress_result_images 의 soft-delete 컬럼 DROP 시 삭제표식(deleted_at/reason/by) 유실 — rollback 은 GO-token 롤백 창에서만.
-- 멱등: IF EXISTS 가드.
-- ============================================================

BEGIN;

-- 단계 3 역순: progress_result_images additive 원복 --------------------------------
DROP TRIGGER IF EXISTS trg_progress_result_images_harddelete_guard ON public.progress_result_images;
DROP FUNCTION IF EXISTS public.progress_result_images_harddelete_guard();

DROP POLICY IF EXISTS "pri_deleted_rows_admin_only" ON public.progress_result_images;
DROP POLICY IF EXISTS "pri_admin_update" ON public.progress_result_images;

DROP INDEX IF EXISTS public.idx_pri_slip;
DROP INDEX IF EXISTS public.idx_pri_active;

ALTER TABLE public.progress_result_images
  DROP COLUMN IF EXISTS is_deleted,
  DROP COLUMN IF EXISTS delete_reason,
  DROP COLUMN IF EXISTS deleted_by,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS slip_id;

-- 단계 2 역순: audit_log + 트리거/함수 ------------------------------------------
DROP TRIGGER IF EXISTS trg_progress_analysis_slips_touch ON public.progress_analysis_slips;
DROP FUNCTION IF EXISTS public.progress_analysis_slips_touch_updated_at();
DROP TRIGGER IF EXISTS trg_progress_analysis_slips_audit ON public.progress_analysis_slips;
DROP FUNCTION IF EXISTS public.progress_analysis_slips_audit();

DROP TABLE IF EXISTS public.progress_analysis_slips_audit_log;

-- 단계 1 역순: slips 테이블 ------------------------------------------------------
DROP TABLE IF EXISTS public.progress_analysis_slips;

COMMIT;
