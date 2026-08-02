-- ============================================================
-- ROLLBACK: T-20260728-foot-FORMSUB-DURABILITY-IMPROVE (트랙 A)
-- ============================================================
-- ⚠️ audit_log 는 append-only 법적 감사자산. 롤백 시 감사이력 소실 유의(정식 롤백 승인 필요).
--   운영 중 되돌림이 필요하면 트리거/정책만 제거하고 테이블·컬럼은 보존하는 부분 롤백을 우선 검토.
-- ============================================================

BEGIN;

-- 단계 4 역: RESTRICTIVE 가시성 정책 제거
DROP POLICY IF EXISTS "fs_deleted_rows_director_only" ON public.form_submissions;

-- 단계 3 역: 감사 트리거·함수 제거
DROP TRIGGER IF EXISTS trg_form_submissions_audit ON public.form_submissions;
DROP FUNCTION IF EXISTS public.form_submissions_body_audit();

-- 단계 2 역: audit_log 정책·인덱스·테이블 제거
DROP POLICY IF EXISTS "fsal_select_approved" ON public.form_submissions_audit_log;
DROP POLICY IF EXISTS "fsal_insert_approved" ON public.form_submissions_audit_log;
DROP INDEX IF EXISTS public.idx_fsal_submission_id;
DROP INDEX IF EXISTS public.idx_fsal_clinic_date;
DROP TABLE IF EXISTS public.form_submissions_audit_log;

-- 단계 1 역: soft-delete 3컬럼 제거 (데이터 존재 시 소실 — 롤백 승인 전제)
ALTER TABLE public.form_submissions
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS deleted_by,
  DROP COLUMN IF EXISTS delete_reason;

COMMIT;
