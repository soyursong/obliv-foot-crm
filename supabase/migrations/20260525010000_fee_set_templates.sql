-- T-20260525-foot-FEE-SET-TEMPLATE: 결제 미니창 수가항목 세트코드(템플릿) 기능
-- fee_set_templates 테이블 생성 + RLS
--
-- 목적: 결제 미니창 좌측 수가항목에 [세트코드] 드롭다운으로 수가항목 일괄 추가
-- items JSONB 형식: [{"service_id": "uuid", "sort_order": 1}, ...]
--
-- rollback: 20260525010000_fee_set_templates.down.sql

CREATE TABLE IF NOT EXISTS fee_set_templates (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  set_name    TEXT        NOT NULL CHECK (char_length(trim(set_name)) > 0),
  items       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- clinic별 세트명 중복 방지 (active 기준)
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_set_templates_clinic_name
  ON fee_set_templates(clinic_id, set_name)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_fee_set_templates_clinic_active
  ON fee_set_templates(clinic_id, is_active, sort_order);

COMMENT ON TABLE fee_set_templates IS
  'T-20260525-foot-FEE-SET-TEMPLATE: 결제 미니창 수가항목 세트코드 템플릿. clinic_id 격리.';

COMMENT ON COLUMN fee_set_templates.items IS
  'JSONB 배열: [{"service_id": "uuid", "sort_order": N}]. services 테이블 FK 역할.';

-- RLS
ALTER TABLE fee_set_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all" ON fee_set_templates
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
