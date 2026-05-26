/**
 * T-20260526-foot-COPAY-MINI-BUG AC-1
 * services 테이블 — AA154/D6203 등 급여 항목 is_insurance_covered true 교정
 * Supabase Management API 경유 직접 실행
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dir, '../supabase/migrations/20260526100000_services_insurance_covered_fix.sql'),
  'utf8',
);

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY  = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const PROJ_REF = 'rxlomoozakkjesdqjtvd';

console.log('🚀 AC-1: services is_insurance_covered 교정 (T-20260526-foot-COPAY-MINI-BUG)');
console.log('SQL:', SQL.substring(0, 200));

const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
  },
  body: JSON.stringify({ query: SQL }),
});

const body = await resp.json();
console.log('Status:', resp.status);
console.log('Response:', JSON.stringify(body, null, 2));

if (!resp.ok) {
  console.error('❌ 실패:', body);
  process.exit(1);
}

console.log('✅ services is_insurance_covered 교정 완료');
