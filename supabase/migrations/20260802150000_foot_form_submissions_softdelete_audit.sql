-- ============================================================
-- T-20260728-foot-FORMSUB-DURABILITY-IMPROVE (트랙 A) — 발행문서 soft-delete + audit (medical_charts 미러)
-- ============================================================
-- ⚠️⚠️ DRAFT / DA CONSULT PENDING — 적용 금지(GO 전 스키마 write 금지, 티켓 dev 착수 순서 §1) ⚠️⚠️
--   본 파일 = DA CONSULT 1차 게이트에 첨부하는 "구체 DDL draft".
--   data-architect CONSULT-REPLY GO + supervisor DDL-diff PASS 이후에만 prod 적용/main merge/deploy-ready.
--
-- reporter: agent-data-architect (DA decision §5, 부모 T-20260728-foot-DOCWRITE-DASH-UNISSUED-DATEFILTER-REOPEN)
-- 근거:
--   · form_submissions(629행) = 법적 의미 있는 발행문서(소견서/진단서). 의료법 제22조(진료기록 수정·삭제 시
--     원본보존·수행자·일시 기록) / 제40조(10년 보존). 현재 soft-delete·audit 전무 → 삭제 forensics·복구 공백.
--   · medical_charts(진료차트)는 이미 full soft-delete + medical_charts_audit_log 보유. 본 마이그는 그 선례를 미러.
--
-- 미러 원본:
--   · supabase/migrations/20260612150000_medical_charts_body_audit.sql (audit_log 테이블 + BEFORE UPDATE 트리거)
--   · supabase/migrations/20260621003000_medical_charts_soft_delete_sameday_unique.sql (soft-delete 컬럼 + 삭제전이 라벨 + RESTRICTIVE 가시성)
--
-- foot 스키마 정합 (medical_charts 와 다른 점):
--   · form_submissions.clinic_id 는 UUID(medical_charts 는 TEXT) → audit.clinic_id 도 UUID.
--   · 기존 immutable 트리거 trg_form_submissions_published_immutable (BEFORE UPDATE OR DELETE, OLD.status='published' 차단) 존재.
--     트리거명 알파벳 순: trg_form_submissions_audit < trg_form_submissions_published_immutable
--     → audit 가 먼저 평가되나 immutable RAISE 시 같은 txn 롤백(audit INSERT 포함)되어 "실패한 삭제"는 감사에 안 남음(정합, medical_charts 동일 논리).
--
-- ⚠️ ADDITIVE ONLY (DROP/타입변경 0). 기존 629행 backfill = deleted_at NULL default(무손실·즉시 반영).
-- 롤백: 20260802150000_foot_form_submissions_softdelete_audit.rollback.sql
-- ============================================================

BEGIN;

-- ── 단계 1. form_submissions soft-delete 3컬럼 (ADDITIVE) ──
--   PG11+ 상수/NULL DEFAULT 는 테이블 rewrite 없이 즉시 반영 → 629행 backfill 경미.
--   ※ medical_charts 는 is_deleted BOOLEAN 도 보유하나, 본 티켓 AC-2 캐논 술어 = `deleted_at IS NULL`.
--     is_deleted 병행 추가 여부는 DA 판단(open Q1, 아래 CONSULT). 기본 draft = deleted_at 캐논 3컬럼만.
ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ NULL,   -- 삭제 일시(의료법 §22 일시). NULL=활성. 캐논 술어.
  ADD COLUMN IF NOT EXISTS deleted_by    UUID        NULL,   -- 삭제 수행자 auth.uid()(§22 수행자). 진실원천=audit_log.changed_by
  ADD COLUMN IF NOT EXISTS delete_reason TEXT        NULL;   -- 삭제 사유(보존)

COMMENT ON COLUMN form_submissions.deleted_at    IS 'soft-delete 일시(NULL=활성). hard-DELETE 대체. 조회 캐논 술어 deleted_at IS NULL. 의료법 §22. T-20260728-foot-FORMSUB-DURABILITY-IMPROVE';
COMMENT ON COLUMN form_submissions.deleted_by    IS '삭제 수행자 auth.uid()(의료법 §22 수행자). 법적 진실원천=form_submissions_audit_log.changed_by';
COMMENT ON COLUMN form_submissions.delete_reason IS '삭제 사유(보존)';

-- ── 단계 2. form_submissions_audit_log (수정/삭제 전·후 전체 행 스냅샷, append-only) ──
--   medical_charts_audit_log 미러. clinic_id 만 UUID.
CREATE TABLE IF NOT EXISTS form_submissions_audit_log (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  form_submission_id  UUID        NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  clinic_id           UUID,                                   -- foot form_submissions.clinic_id = UUID
  old_data            JSONB       NOT NULL,                   -- 수정/삭제 전 원본 전체 행(의료법 §22)
  new_data            JSONB,                                  -- 수정본 전체 행
  changed_by          UUID,                                   -- 수행자 auth.uid()(누가)
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),     -- 언제
  operation           TEXT        NOT NULL DEFAULT 'UPDATE' CHECK (operation IN ('UPDATE', 'DELETE'))
);

CREATE INDEX IF NOT EXISTS idx_fsal_submission_id
  ON form_submissions_audit_log (form_submission_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_fsal_clinic_date
  ON form_submissions_audit_log (clinic_id, changed_at DESC);

COMMENT ON TABLE form_submissions_audit_log IS
  '발행문서(소견서/진단서 등) 수정·삭제 이력 Audit Trail(append-only). 수정/삭제 전 원본+수정본 보존. 의료법 제22조 (T-20260728-foot-FORMSUB-DURABILITY-IMPROVE)';

ALTER TABLE form_submissions_audit_log ENABLE ROW LEVEL SECURITY;

-- SELECT: 승인된 사용자(감사 조회). foot 컨벤션 is_approved_user() 준용(medical_charts_audit_log 동일).
DROP POLICY IF EXISTS "fsal_select_approved" ON form_submissions_audit_log;
CREATE POLICY "fsal_select_approved" ON form_submissions_audit_log
  FOR SELECT TO authenticated
  USING (is_approved_user());

-- INSERT: 트리거(SECURITY DEFINER) 경유 적재. 직접 INSERT 도 승인 사용자만.
DROP POLICY IF EXISTS "fsal_insert_approved" ON form_submissions_audit_log;
CREATE POLICY "fsal_insert_approved" ON form_submissions_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (is_approved_user());

-- UPDATE/DELETE 정책 없음 → RLS default deny(append-only 강제, 위변조 불가). service_role 만 정리 가능.

-- ── 단계 3. BEFORE UPDATE 감사 트리거 on form_submissions ──
--   soft-delete 전이(deleted_at NULL→NOT NULL) = operation 'DELETE' 라벨, 그 외 본문 수정 = 'UPDATE'.
--   FE 경로 누락·우회와 무관하게 모든 UPDATE 가 DB 레벨에서 감사됨(medical_charts 설계정신 계승).
--   ※ 기존 immutable 트리거와 공존(별도 트리거명, 본 트리거는 NEW 무변형 RETURN NEW → 저장 페이로드 회귀 0).
CREATE OR REPLACE FUNCTION public.form_submissions_body_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op TEXT;
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    v_op := 'DELETE';
  ELSE
    v_op := 'UPDATE';
  END IF;

  INSERT INTO form_submissions_audit_log (
    form_submission_id, clinic_id, old_data, new_data, changed_by, operation
  ) VALUES (
    OLD.id, OLD.clinic_id,
    row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb,
    auth.uid(), v_op
  );
  RETURN NEW;  -- NEW 무변형 → 저장 페이로드 회귀 0
END;
$$;

COMMENT ON FUNCTION public.form_submissions_body_audit() IS
  'form_submissions BEFORE UPDATE 본문·삭제 감사(append-only): 수정/삭제 전 원본+수정본 보존. soft-delete 전이는 operation=DELETE 라벨. 의료법 제22조 (T-20260728-foot-FORMSUB-DURABILITY-IMPROVE)';

DROP TRIGGER IF EXISTS trg_form_submissions_audit ON public.form_submissions;
CREATE TRIGGER trg_form_submissions_audit
  BEFORE UPDATE ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public.form_submissions_body_audit();

-- ── 단계 4. soft-delete 행 가시성 제한 (RESTRICTIVE, ADDITIVE) — [OPEN Q3: DA 확정 대기] ──
--   medical_charts 는 삭제행을 director/admin 만 SELECT(RESTRICTIVE) 로 제한.
--   form_submissions 도 동형 적용하되, FE 조회는 별도로 deleted_at IS NULL 필터(무회귀).
--   ※ current_user_role() helper 사용. helper 부재/역할셋 상이 시 DA 확정 후 조정.
--   ※ RESTRICTIVE 는 기존 permissive(form_submissions_read, clinic 격리)와 AND → 비삭제행 노출 종전과 동일(무회귀).
DROP POLICY IF EXISTS "fs_deleted_rows_director_only" ON form_submissions;
CREATE POLICY "fs_deleted_rows_director_only" ON form_submissions
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    OR current_user_role() = ANY (ARRAY['director'::text, 'admin'::text])
  );

COMMENT ON POLICY "fs_deleted_rows_director_only" ON form_submissions IS
  'soft-delete 발행문서(deleted_at NOT NULL)는 director/admin 만 조회. RESTRICTIVE=기존 clinic 격리와 AND. T-20260728-foot-FORMSUB-DURABILITY-IMPROVE';

-- ── 검증(마이그레이션 자체 유효성) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='form_submissions' AND column_name='deleted_at') THEN
    RAISE EXCEPTION 'form_submissions.deleted_at 컬럼 추가 실패';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='form_submissions_audit_log') THEN
    RAISE EXCEPTION 'form_submissions_audit_log 테이블 생성 실패';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgname='trg_form_submissions_audit' AND tgrelid='form_submissions'::regclass) THEN
    RAISE EXCEPTION 'trg_form_submissions_audit 트리거 생성 실패';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='form_submissions_audit_log' AND cmd IN ('UPDATE','DELETE')) THEN
    RAISE EXCEPTION 'form_submissions_audit_log 에 UPDATE/DELETE 정책 존재 — append-only 위반';
  END IF;
  RAISE NOTICE 'T-20260728-foot-FORMSUB-DURABILITY-IMPROVE 트랙A: 모든 검증 통과';
END $$;

COMMIT;
