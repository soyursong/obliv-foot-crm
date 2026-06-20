-- ============================================================
-- T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY (Phase B) — 진료차트 soft-delete + 동일일 1차트 하드닝
-- ============================================================
-- reporter: 문지은 대표원장 (U0ALGAAAJAV) / DA CONSULT: GO_CONDITIONAL (MSG-234254-akuj)
-- 근거:
--   · 의료법 제22조 3항 — 전자의무기록 수정·삭제 시 ①원본보존 ②수행자 ③일시 기록 의무 → hard-delete 금지, soft-delete만.
--   · 의료법 제40조 — 진료기록 10년 보존.
--   · 같은날 정책 grounding(도수치료 급여기준 동일상병 1일1회 + 한국 EMR 실무 동일일 1차트 이어쓰기)
--     → 현행 append 설계 유지 + 동일일 partial UNIQUE index 로 구조 차단(T-20260611 dup INSERT 재발방지).
--
-- ⚠️ ADDITIVE ONLY (파괴 변경 0). supervisor DDL-diff 게이트 경유 후 적용. dev-foot 직접 실행.
-- ⚠️ partial UNIQUE index 는 본 파일에 포함하지 않는다 — CREATE INDEX CONCURRENTLY 는 트랜잭션 밖에서만 가능하고,
--    기존 동일일 중복행 dedup(Bucket A soft-delete) 선행이 필수이기 때문.
--    인덱스 생성은 별도 apply 스크립트(scripts/...sameday_index_apply.mjs)에서 dedup 후 CONCURRENTLY 로 수행.
--
-- 마이그 6단계 중 본 파일 = 단계 1·2(+트리거 DELETE 라벨링·RLS 가시성). 단계 3~6 = apply 스크립트.
-- 롤백: 20260621003000_medical_charts_soft_delete_sameday_unique.rollback.sql
-- ============================================================

BEGIN;

-- ── 단계 1. medical_charts soft-delete 4컬럼 (ADDITIVE) ──
--   PG11+ 상수 DEFAULT 는 테이블 rewrite 없이 즉시 반영 → 핫테이블 안전.
ALTER TABLE medical_charts
  ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by    UUID        NULL,   -- 삭제 수행자 auth.uid()(의료법 §22-3 '수행자'). 감사 진실원천은 audit_log.changed_by.
  ADD COLUMN IF NOT EXISTS delete_reason TEXT        NULL;   -- 삭제 사유(보존)

COMMENT ON COLUMN medical_charts.is_deleted    IS 'soft-delete(무효화) 플래그. hard-delete 금지(의료법 §22-3). 목록 기본 숨김, director/admin 만 조회. T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY';
COMMENT ON COLUMN medical_charts.deleted_at    IS '삭제 일시(의료법 §22-3 일시 기록)';
COMMENT ON COLUMN medical_charts.deleted_by    IS '삭제 수행자 auth.uid()(의료법 §22-3 수행자 기록). 법적 진실원천=medical_charts_audit_log.changed_by';
COMMENT ON COLUMN medical_charts.delete_reason IS '삭제 사유(보존)';

-- ── 단계 2. medical_charts_audit_log.operation CHECK superset 확장 (ADDITIVE-safe) ──
--   현재 CHECK (operation = 'UPDATE') → IN ('UPDATE','DELETE') 로 superset 확장.
--   superset 이므로 기존행(operation='UPDATE') 전부 통과 = 무손실.
ALTER TABLE medical_charts_audit_log
  DROP CONSTRAINT IF EXISTS medical_charts_audit_log_operation_check;
ALTER TABLE medical_charts_audit_log
  ADD CONSTRAINT medical_charts_audit_log_operation_check
  CHECK (operation IN ('UPDATE', 'DELETE'));

-- ── 본문 감사 트리거 갱신: soft-delete 전이(is_deleted false→true)는 operation='DELETE' 로 라벨링 ──
--   기존 BEFORE UPDATE 트리거 medical_charts_body_audit() 를 확장. soft-delete 도 물리적으로는 UPDATE 이므로
--   기존 트리거가 이미 자동 감사하나, 의료법 §22-3 '삭제' 의미를 audit 라벨로 명료화한다(append-only 보존 동일).
--   FE 경로 누락·우회와 무관하게 모든 삭제가 DB 레벨에서 'DELETE' 로 감사된다(설계 정신 계승: T-20260612 §15).
CREATE OR REPLACE FUNCTION medical_charts_body_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op TEXT;
BEGIN
  -- soft-delete 전이 감지: 활성→삭제 = 'DELETE', 그 외 본문 수정 = 'UPDATE'
  IF COALESCE(OLD.is_deleted, false) = false AND COALESCE(NEW.is_deleted, false) = true THEN
    v_op := 'DELETE';
  ELSE
    v_op := 'UPDATE';
  END IF;

  INSERT INTO medical_charts_audit_log (
    medical_chart_id,
    clinic_id,
    old_data,
    new_data,
    changed_by,
    operation
  ) VALUES (
    OLD.id,
    OLD.clinic_id,
    row_to_json(OLD)::jsonb,
    row_to_json(NEW)::jsonb,
    auth.uid(),
    v_op
  );
  RETURN NEW;  -- NEW 무변형 → 저장 페이로드 회귀 0
END;
$$;

COMMENT ON FUNCTION medical_charts_body_audit() IS
  'medical_charts BEFORE UPDATE 본문 감사(append-only): 수정 전 원본+수정본 보존. soft-delete 전이는 operation=DELETE 라벨. 의료법 제22조 3항 (T-20260612-foot-MEDLAW22-A-CHART-AUDIT / T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY)';

-- ── soft-delete 행 가시성 제한: 삭제된 차트는 director/admin 만 SELECT (RESTRICTIVE, ADDITIVE) ──
--   기존 permissive 정책 mc_clinic_isolated_v3(clinic 격리)는 그대로 둔다(미변경).
--   RESTRICTIVE 정책은 permissive 와 AND 결합 → "삭제행은 director/admin 만" 추가 제약을 비파괴적으로 부과.
--   비삭제행(is_deleted=false)은 종전과 동일하게 노출(무회귀).
DROP POLICY IF EXISTS "mc_deleted_rows_director_only" ON medical_charts;
CREATE POLICY "mc_deleted_rows_director_only" ON medical_charts
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    is_deleted = false
    OR current_user_role() = ANY (ARRAY['director'::text, 'admin'::text])
  );

COMMENT ON POLICY "mc_deleted_rows_director_only" ON medical_charts IS
  'soft-delete 차트(is_deleted=true)는 director/admin 만 조회. RESTRICTIVE=기존 clinic 격리 정책과 AND. T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY';

-- ── 검증(마이그레이션 자체 유효성) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='medical_charts' AND column_name='is_deleted') THEN
    RAISE EXCEPTION 'medical_charts.is_deleted 컬럼 추가 실패';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='medical_charts_audit_log_operation_check'
      AND pg_get_constraintdef(oid) ILIKE '%DELETE%') THEN
    RAISE EXCEPTION 'audit_log operation CHECK DELETE superset 확장 실패';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='medical_charts' AND policyname='mc_deleted_rows_director_only') THEN
    RAISE EXCEPTION 'mc_deleted_rows_director_only RESTRICTIVE 정책 생성 실패';
  END IF;
  RAISE NOTICE 'T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY 단계1·2: 모든 검증 통과';
END $$;

COMMIT;
