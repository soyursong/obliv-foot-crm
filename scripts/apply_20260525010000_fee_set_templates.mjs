/**
 * T-20260525-foot-FEE-SET-TEMPLATE AC-3
 * fee_set_templates 테이블 생성 + RLS
 * Supabase Management API (service_role) 경유 직접 실행
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY  = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const PROJ_REF = 'rxlomoozakkjesdqjtvd';

const SQL = `
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_set_templates_clinic_name
  ON fee_set_templates(clinic_id, set_name)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_fee_set_templates_clinic_active
  ON fee_set_templates(clinic_id, is_active, sort_order);

COMMENT ON TABLE fee_set_templates IS
  'T-20260525-foot-FEE-SET-TEMPLATE: 결제 미니창 수가항목 세트코드 템플릿. clinic_id 격리.';

COMMENT ON COLUMN fee_set_templates.items IS
  'JSONB 배열: [{"service_id": "uuid", "sort_order": N}]. services 테이블 FK 역할.';

ALTER TABLE fee_set_templates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'fee_set_templates' AND policyname = 'auth_all'
  ) THEN
    EXECUTE 'CREATE POLICY "auth_all" ON fee_set_templates FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END
$$;
`;

console.log('🚀 fee_set_templates 테이블 생성 (T-20260525-foot-FEE-SET-TEMPLATE AC-3)');

// Supabase Management API — /v1/projects/{ref}/database/query
const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
  },
  body: JSON.stringify({ query: SQL }),
});

if (!resp.ok) {
  const text = await resp.text();
  console.log(`⚠️  Management API 응답 ${resp.status}: ${text}`);
} else {
  const body = await resp.json();
  console.log('✅ Management API SQL 실행 결과:', JSON.stringify(body).slice(0, 200));
}

// 검증: fee_set_templates select
const { data: sample, error: sampleErr } = await supabase
  .from('fee_set_templates')
  .select('id, set_name')
  .limit(1);

if (sampleErr) {
  console.error('❌ fee_set_templates select 오류:', sampleErr.message);
  console.log('\n→ Supabase SQL Editor에서 수동 적용 필요:');
  console.log(SQL);
  process.exit(1);
}

console.log('✅ fee_set_templates 테이블 존재 확인 OK (rows:', sample?.length ?? 0, ')');
