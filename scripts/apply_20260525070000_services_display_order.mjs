/**
 * T-20260525-foot-FEE-ITEM-REORDER AC-6
 * services 테이블 display_order 컬럼 추가
 * Supabase Management API (service_role) 경유 직접 실행
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const PROJ_REF = 'rxlomoozakkjesdqjtvd';

const SQL = `
ALTER TABLE services ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

UPDATE services
SET display_order = sort_order
WHERE display_order = 0;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY clinic_id
      ORDER BY sort_order, created_at
    ) - 1 AS rn
  FROM services
  WHERE display_order = 0
)
UPDATE services s
SET display_order = r.rn
FROM ranked r
WHERE s.id = r.id;

CREATE INDEX IF NOT EXISTS idx_services_clinic_display_order
  ON services(clinic_id, display_order);

COMMENT ON COLUMN services.display_order IS
  'T-20260525-foot-FEE-ITEM-REORDER AC-6: clinic 단위 결제 미니창 수가 항목 표시 순서.';
`;

console.log('🚀 services.display_order 컬럼 추가 (T-20260525-foot-FEE-ITEM-REORDER AC-6)');

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

// 검증: services select (display_order 컬럼 확인)
const { data: sample, error: sampleErr } = await supabase
  .from('services')
  .select('id, name, display_order')
  .limit(3);

if (sampleErr) {
  console.error('❌ services.display_order select 오류:', sampleErr.message);
  console.log('\n→ Supabase SQL Editor에서 수동 적용 필요:');
  console.log(SQL);
  process.exit(1);
}

console.log('✅ services.display_order 컬럼 존재 확인 OK');
console.log('   샘플:', sample?.map(s => `${s.name}(${s.display_order})`).join(', '));
