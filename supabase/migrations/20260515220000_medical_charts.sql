-- T-20260515-foot-MEDICAL-CHART-V1: 풋센터 진료차트 1차 구현
-- medical_charts: 방문별 진료 기록 (주호소/증상/진단/시술/결과)
-- chart_doctor_memos: 원장 전용 메모 (RLS: director/admin 역할만 접근)
-- rollback: 20260515220000_medical_charts_rollback.sql
-- supervisor 승인 필요 (prod DB, 신규 테이블)
-- CRM primary T-20260515-crm-MEDICAL-CHART-V1 동일 구조

-- 1. medical_charts 테이블 (방문별 진료 기록)
CREATE TABLE IF NOT EXISTS medical_charts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID NOT NULL,
  clinic_id        TEXT NOT NULL,
  visit_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  chief_complaint  TEXT,               -- 주호소/증상
  diagnosis        TEXT,               -- 진단명
  treatment_record TEXT,               -- 치료/시술명
  materials_used   TEXT,               -- 사용 재료
  treatment_result TEXT,               -- 치료 결과
  created_by       TEXT,               -- 작성자 이메일
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mc_customer_clinic
  ON medical_charts (customer_id, clinic_id);

CREATE INDEX IF NOT EXISTS idx_mc_visit_date
  ON medical_charts (clinic_id, visit_date DESC);

ALTER TABLE medical_charts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mc_authenticated_all" ON medical_charts
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE medical_charts IS
  '방문별 진료 기록 (주호소/진단/시술/결과) — T-20260515-foot-MEDICAL-CHART-V1';

-- 2. chart_doctor_memos 테이블 (원장 전용 메모, RLS 강제)
CREATE TABLE IF NOT EXISTS chart_doctor_memos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medical_chart_id UUID NOT NULL REFERENCES medical_charts(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL,
  clinic_id        TEXT NOT NULL,
  memo             TEXT NOT NULL,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- medical_chart_id는 1:1 관계
CREATE UNIQUE INDEX IF NOT EXISTS idx_cdm_chart_id
  ON chart_doctor_memos (medical_chart_id);

CREATE INDEX IF NOT EXISTS idx_cdm_customer_clinic
  ON chart_doctor_memos (customer_id, clinic_id);

ALTER TABLE chart_doctor_memos ENABLE ROW LEVEL SECURITY;

-- director/admin만 접근 — user_profiles.role 기반 RLS
CREATE POLICY "cdm_director_only" ON chart_doctor_memos
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
       WHERE id = auth.uid()
         AND role IN ('director', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
       WHERE id = auth.uid()
         AND role IN ('director', 'admin')
    )
  );

COMMENT ON TABLE chart_doctor_memos IS
  '원장 전용 진료 메모 — director/admin 역할만 RLS 접근 (T-20260515-foot-MEDICAL-CHART-V1)';

-- 검증
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'medical_charts'
  ) THEN
    RAISE EXCEPTION 'medical_charts 테이블 생성 실패';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'chart_doctor_memos'
  ) THEN
    RAISE EXCEPTION 'chart_doctor_memos 테이블 생성 실패';
  END IF;
END $$;
