-- ============================================================
-- T-20260612-foot-MEDLAW22-A-CHART-AUDIT (⑤): 발톱 진료차트 본문 수정이력 보존
-- ============================================================
-- 근거: 의료법 제22조 3항 — 진료기록부 수정 시 수정 전 원본 + 수정본을 모두 보존해야 한다.
-- 갭: MedicalChartPanel handleSave 가 medical_charts 를 in-place UPDATE 로 덮어써
--     본문(diagnosis/treatment_record/clinical_progress/prescription_items 등) 수정 전 내용이 소실.
--     진료의 변경(medical_chart_signer_audit)·처방(rx_audit_log)은 이미 append-only 이나 본문만 미커버.
--
-- 이식 원본: obliv-body-crm/supabase/migrations/20260516_body_061_medical_audit_log.sql
--   (medical_charts_audit_log: old_data/new_data JSONB + BEFORE UPDATE 트리거 자동 캡처)
--
-- foot 스키마 정합:
--   · medical_charts.clinic_id 는 TEXT(UUID 문자열). audit 의 clinic_id 도 TEXT.
--   · RLS helper 는 foot 컨벤션 is_approved_user() 사용(body 의 is_director_or_admin() 미존재).
--   · 본문 캡처를 FE INSERT 가 아닌 DB BEFORE UPDATE 트리거로 구현 →
--     FE 경로(MedicalChartPanel) 누락·우회와 무관하게 모든 UPDATE 가 감사된다.
--
-- 기존 audit 구조와 정합(중복 트리거 충돌 금지):
--   · medical_charts 에는 이미 trg_enforce_medchart_signing_doctor (BEFORE INSERT OR UPDATE) 존재.
--   · 본 트리거 trg_medical_charts_body_audit 는 BEFORE UPDATE 전용. 트리거명 알파벳 순서상
--     enforce(트g_enforce…) 가 먼저 평가 → 진료의 NULL 이면 enforce 가 예외로 트랜잭션 중단,
--     같은 트랜잭션 내 audit INSERT 도 함께 롤백되어 "실패한 수정"은 감사에 남지 않는다(정합).
--   · INSERT 에는 발화하지 않음 → 신규 차트 작성 동선 무영향(저장 지연·실패 회귀 0).
--
-- 안전성:
--   · 신규 테이블 + BEFORE UPDATE 트리거 1개만 추가 → medical_charts 스키마 변경 없음.
--   · 트리거는 RETURN NEW 만 수행(NEW 무변형) → 기존 저장 페이로드 그대로 반영(회귀 0).
--   · append-only(UPDATE/DELETE 정책 없음) → 감사 무결성.
-- 롤백: 20260612150000_medical_charts_body_audit.rollback.sql
-- ⚠️ supervisor SQL 게이트 경유(신규 테이블 + 트리거). DB 마이그레이션은 dev-foot 직접 실행.
-- ============================================================

BEGIN;

-- ── A. medical_charts_audit_log (본문 수정 전/후 전체 행 스냅샷, append-only) ──
CREATE TABLE IF NOT EXISTS medical_charts_audit_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  medical_chart_id  UUID        NOT NULL REFERENCES medical_charts(id) ON DELETE CASCADE,
  clinic_id         TEXT,                                    -- foot 스키마: clinic_id TEXT(스코핑/조회용)
  old_data          JSONB       NOT NULL,                    -- 수정 전 원본 전체 행(의료법 제22조 3항)
  new_data          JSONB,                                   -- 수정본 전체 행
  changed_by        UUID,                                    -- 수정 수행자 auth.uid()(누가)
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),      -- 언제
  operation         TEXT        NOT NULL DEFAULT 'UPDATE' CHECK (operation IN ('UPDATE'))
);

CREATE INDEX IF NOT EXISTS idx_mcal_chart_id
  ON medical_charts_audit_log (medical_chart_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcal_clinic_date
  ON medical_charts_audit_log (clinic_id, changed_at DESC);

COMMENT ON TABLE medical_charts_audit_log IS
  '발톱 진료차트 본문 수정이력 Audit Trail(append-only) — 수정 전 원본+수정본 보존. 의료법 제22조 3항 (T-20260612-foot-MEDLAW22-A-CHART-AUDIT)';

ALTER TABLE medical_charts_audit_log ENABLE ROW LEVEL SECURITY;

-- SELECT: 승인된 사용자(감사 조회). foot 컨벤션 is_approved_user() 준용(signer_audit 동일).
DROP POLICY IF EXISTS "mcal_select_approved" ON medical_charts_audit_log;
CREATE POLICY "mcal_select_approved" ON medical_charts_audit_log
  FOR SELECT TO authenticated
  USING (is_approved_user());

-- INSERT: 트리거(SECURITY DEFINER) 경유 적재. 직접 INSERT 도 승인 사용자만.
DROP POLICY IF EXISTS "mcal_insert_approved" ON medical_charts_audit_log;
CREATE POLICY "mcal_insert_approved" ON medical_charts_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (is_approved_user());

-- UPDATE/DELETE 정책 없음 → RLS default deny(append-only 강제, 위변조 불가). service_role 만 정리 가능.

-- ── B. BEFORE UPDATE 트리거 on medical_charts (본문 수정 전/후 자동 스냅샷) ──
--   row_to_json(OLD) = 수정 전 원본 전체, row_to_json(NEW) = 수정본 전체.
--   trg_enforce_medchart_signing_doctor 와 공존(별도 트리거명, 본 트리거는 NEW 무변형).
CREATE OR REPLACE FUNCTION medical_charts_body_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
    'UPDATE'
  );
  RETURN NEW;  -- NEW 무변형 → 저장 페이로드 회귀 0
END;
$$;

DROP TRIGGER IF EXISTS trg_medical_charts_body_audit ON medical_charts;
CREATE TRIGGER trg_medical_charts_body_audit
  BEFORE UPDATE ON medical_charts
  FOR EACH ROW EXECUTE FUNCTION medical_charts_body_audit();

COMMENT ON FUNCTION medical_charts_body_audit() IS
  'medical_charts BEFORE UPDATE 본문 감사: 수정 전 원본(old_data)+수정본(new_data) 보존. 의료법 제22조 3항 (T-20260612-foot-MEDLAW22-A-CHART-AUDIT)';

-- ── C. 검증(마이그레이션 자체 유효성) ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'medical_charts_audit_log'
  ) THEN
    RAISE EXCEPTION 'medical_charts_audit_log 테이블 생성 실패';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_medical_charts_body_audit'
       AND tgrelid = 'medical_charts'::regclass
  ) THEN
    RAISE EXCEPTION 'trg_medical_charts_body_audit 트리거 생성 실패';
  END IF;

  -- append-only 확인: UPDATE/DELETE 정책 부재
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'medical_charts_audit_log'
       AND cmd IN ('UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'medical_charts_audit_log 에 UPDATE/DELETE 정책 존재 — append-only 위반';
  END IF;

  -- 기존 enforce 트리거 공존 확인(중복/충돌 없음)
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_enforce_medchart_signing_doctor'
       AND tgrelid = 'medical_charts'::regclass
  ) THEN
    RAISE WARNING 'trg_enforce_medchart_signing_doctor 부재 — 기존 진료의 강제 트리거 확인 필요';
  END IF;

  RAISE NOTICE 'T-20260612-foot-MEDLAW22-A-CHART-AUDIT: 모든 검증 통과';
END $$;

COMMIT;
