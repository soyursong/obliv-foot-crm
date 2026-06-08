-- ============================================================
-- T-20260608-foot-MEDCHART-SIGN-AUDIT (Phase 2): 진료기록 진료의 귀속 + 변경이력 audit + 신규행 강제
-- ============================================================
-- 근거: 의료법 — 진료기록부에는 진료의(작성 의사)의 서명/표기가 반드시 포함되어야 한다.
-- 현장 결정(문지은 대표원장, MSG-20260608-174251):
--   ① 진료의 귀속: 로그인 계정이 의사면 자동 본인 + 드롭다운 수동 변경(스탭 포함) 가능, 변경이력 audit 필수
--   ② 서명 방식: A — 등록 직인/이름 자동삽입(Canvas 손서명 B 불채택)
--   ③ 강제 범위: 신규/수정행만 NOT NULL/CHECK 강제. 과거 NULL행 backfill 금지(현장 "다 더미데이터")
--
-- 안전성:
--   - medical_charts 신규 컬럼 = 전부 NULLABLE 추가 → 기존(레거시) 행 무영향.
--   - 강제는 NOT NULL 컬럼이 아니라 BEFORE INSERT OR UPDATE 트리거로 구현 →
--     레거시 NULL 행은 "수정되지 않는 한" 면제(backfill 금지 준수). 신규/수정 시점에만 강제.
--   - medical_chart_signer_audit = 신규 테이블(append-only) → 기존 데이터 무영향.
--   - medical_charts 쓰기 경로는 FE MedicalChartPanel(insert/update) 단 1곳(EF/RPC 없음) → 공격면 좁음.
-- 롤백: 20260608170000_medchart_signing_doctor.rollback.sql
-- ============================================================

BEGIN;

-- ── A. medical_charts 진료의 귀속 컬럼 (전부 nullable — 레거시 면제) ──
ALTER TABLE medical_charts
  ADD COLUMN IF NOT EXISTS signing_doctor_id      UUID REFERENCES clinic_doctors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signing_doctor_name    TEXT,   -- 저장시점 진료의 이름 스냅샷(법적 추적성/출력 표기)
  ADD COLUMN IF NOT EXISTS signing_doctor_seal_url TEXT;  -- 저장시점 직인 storage path 스냅샷(없으면 이름 텍스트로 표기)

CREATE INDEX IF NOT EXISTS idx_medical_charts_signing_doctor ON medical_charts(signing_doctor_id);

COMMENT ON COLUMN medical_charts.signing_doctor_id   IS 'T-MEDCHART-SIGN-AUDIT: 진료의(clinic_doctors.id). 신규/수정행 NOT NULL 강제(트리거), 레거시 NULL 면제';
COMMENT ON COLUMN medical_charts.signing_doctor_name IS '저장시점 진료의 이름 스냅샷(의사 레코드 변경/삭제와 무관하게 출력 표기 보존)';
COMMENT ON COLUMN medical_charts.signing_doctor_seal_url IS '저장시점 직인 storage path 스냅샷(없으면 이름 텍스트 표기)';

-- ── B. 진료의 변경이력 audit (append-only, AC-P2-3) ──
CREATE TABLE IF NOT EXISTS medical_chart_signer_audit (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  medical_chart_id  UUID NOT NULL REFERENCES medical_charts(id) ON DELETE CASCADE,
  clinic_id         TEXT,                                    -- foot 스키마: clinic_id TEXT(UUID 문자열 보관)
  old_doctor_id     UUID,
  old_doctor_name   TEXT,
  new_doctor_id     UUID,
  new_doctor_name   TEXT,
  changed_by        TEXT,                                    -- 변경 수행자 로그인 이메일(누가)
  changed_by_name   TEXT,
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT now()       -- 언제
);
CREATE INDEX IF NOT EXISTS idx_mc_signer_audit_chart ON medical_chart_signer_audit(medical_chart_id, changed_at);

COMMENT ON TABLE medical_chart_signer_audit IS 'T-MEDCHART-SIGN-AUDIT: 진료기록 진료의 귀속 변경이력(append-only). 누가·언제·이전값→새값. 덮어쓰기 금지(UPDATE/DELETE 정책 없음).';

ALTER TABLE medical_chart_signer_audit ENABLE ROW LEVEL SECURITY;

-- SELECT: 승인된 같은 클리닉 사용자(차트 단위 조회)
DROP POLICY IF EXISTS "mc_signer_audit_select" ON medical_chart_signer_audit;
CREATE POLICY "mc_signer_audit_select" ON medical_chart_signer_audit
  FOR SELECT TO authenticated
  USING (is_approved_user());

-- INSERT: 승인된 사용자만. UPDATE/DELETE 정책을 두지 않음 = RLS로 변경/삭제 차단(append-only 강제).
DROP POLICY IF EXISTS "mc_signer_audit_insert" ON medical_chart_signer_audit;
CREATE POLICY "mc_signer_audit_insert" ON medical_chart_signer_audit
  FOR INSERT TO authenticated
  WITH CHECK (is_approved_user());

-- ── C. 신규/수정행 진료의 강제 (트리거 — 레거시 NULL행 면제) ──
--   NOT NULL 컬럼 대신 트리거 사용 이유: 기존 레거시 행(signing_doctor_id NULL)을
--   backfill 없이 보존해야 하므로(AC-7/AC-P2-6). INSERT/UPDATE 시점에만 강제한다.
CREATE OR REPLACE FUNCTION enforce_medchart_signing_doctor()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.signing_doctor_id IS NULL THEN
    RAISE EXCEPTION '진료의(signing_doctor) 없이 진료기록을 저장할 수 없습니다 (의료법)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_medchart_signing_doctor ON medical_charts;
CREATE TRIGGER trg_enforce_medchart_signing_doctor
  BEFORE INSERT OR UPDATE ON medical_charts
  FOR EACH ROW EXECUTE FUNCTION enforce_medchart_signing_doctor();

COMMIT;
