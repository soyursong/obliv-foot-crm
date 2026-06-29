/**
 * T-20260526-foot-COPAY-MINI-BUG AC-2
 * calc_copayment 함수 — hira_score NULL 시 price 폴백 추가
 * Supabase Management API 경유 직접 실행
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dir, '../supabase/migrations/20260526110000_calc_copayment_price_fallback.sql'),
  'utf8',
);

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const PROJ_REF = 'rxlomoozakkjesdqjtvd';

console.log('🚀 AC-2: calc_copayment 함수 업데이트 (T-20260526-foot-COPAY-MINI-BUG)');

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

console.log('✅ calc_copayment 함수 업데이트 완료');
