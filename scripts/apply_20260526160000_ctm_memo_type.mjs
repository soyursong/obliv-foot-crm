/**
 * T-20260526-foot-VISIT-HIST-FILTER
 * customer_treatment_memos.memo_type 컬럼 추가
 * Supabase Management API 경유 직접 실행
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dir, '../supabase/migrations/20260526160000_ctm_memo_type.sql'),
  'utf8',
);

const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const PROJ_REF = 'rxlomoozakkjesdqjtvd';

console.log('🚀 T-20260526-foot-VISIT-HIST-FILTER: memo_type 컬럼 추가');

const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
  },
  body: JSON.stringify({ query: SQL }),
});

const body = await resp.json();
if (!resp.ok) {
  console.error('❌ 실패:', JSON.stringify(body, null, 2));
  process.exit(1);
}
console.log('✅ memo_type 컬럼 추가 완료:', JSON.stringify(body));
