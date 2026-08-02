-- ============================================================
-- ROLLBACK: T-20260728-foot-FORMSUB-DURABILITY-IMPROVE (트랙 A)
-- ============================================================
-- ⚠️ form_submissions_audit_log 는 append-only 법적 감사자산. 롤백 시 감사이력 소실 유의(정식 롤백 승인 필요).
--   운영 중 되돌림이 필요하면 트리거/정책만 제거하고 테이블·컬럼은 보존하는 부분 롤백을 우선 검토.
-- ⚠️ immutable guard 는 본 마이그 전의 "published-only 차단"(hard-DELETE 전면차단 없음) 정의로 복원한다
--   → 롤백 후 non-published 물리삭제가 다시 가능해짐(durability 갭 재개방). 승인 전제.
-- ============================================================

BEGIN;

-- 단계 5 역: RESTRICTIVE 가시성 정책 제거
DROP POLICY IF EXISTS "fs_deleted_rows_director_only" ON public.form_submissions;

-- 단계 4 역: immutable guard 를 본 마이그 이전 정의(published-only 차단)로 복원.
--   출처: 20260616160000_opinion_doc_form_stack.sql SECTION 1(a).
CREATE OR REPLACE FUNCTION public.form_submissions_published_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION '발행된 의무기록(소견서·검사결과지)은 수정·삭제할 수 없습니다 — 정정은 신규 발행으로만 가능합니다'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_form_submissions_published_immutable ON public.form_submissions;
CREATE TRIGGER trg_form_submissions_published_immutable
  BEFORE UPDATE OR DELETE ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public.form_submissions_published_immutable_guard();

-- 단계 3 역: 감사 트리거·함수 제거
DROP TRIGGER IF EXISTS trg_form_submissions_body_audit ON public.form_submissions;
DROP TRIGGER IF EXISTS trg_form_submissions_audit ON public.form_submissions;   -- draft 명(있으면)
DROP FUNCTION IF EXISTS public.form_submissions_body_audit();

-- 단계 2 역: audit_log 정책·인덱스·테이블 제거
DROP POLICY IF EXISTS "fsal_select_director_admin" ON public.form_submissions_audit_log;
DROP POLICY IF EXISTS "fsal_select_approved" ON public.form_submissions_audit_log;
DROP POLICY IF EXISTS "fsal_insert_approved" ON public.form_submissions_audit_log;
DROP INDEX IF EXISTS public.idx_fsal_submission_id;
DROP INDEX IF EXISTS public.idx_fsal_clinic_date;
DROP TABLE IF EXISTS public.form_submissions_audit_log;

-- 단계 1 역: partial index + soft-delete 4컬럼 제거 (데이터 존재 시 소실 — 롤백 승인 전제)
DROP INDEX IF EXISTS public.idx_form_submissions_active;
ALTER TABLE public.form_submissions
  DROP COLUMN IF EXISTS is_deleted,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS deleted_by,
  DROP COLUMN IF EXISTS delete_reason;

COMMIT;
