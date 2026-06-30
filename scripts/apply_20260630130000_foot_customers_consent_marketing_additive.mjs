/**
 * T-20260630-foot-CUSTOMERS-CONSENT-MARKETING-COL (P0 hotfix)
 * customers.consent_marketing BOOLEAN nullable DEFAULT FALSE — ADDITIVE 1컬럼.
 * Supabase Management API 경유 직접 실행 (대시보드 수동 실행 금지 정책).
 *
 * ⚠ supervisor DDL-diff 게이트 + data-architect §6-1 컬럼스펙 CONSULT GO 후 prod 적용.
 *   ADDITIVE nullable DEFAULT false → blast 0. ADD COLUMN IF NOT EXISTS = 멱등.
 * rollback: node scripts/apply_20260630130000_foot_customers_consent_marketing_additive.mjs --rollback
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes('--rollback');
const file = rollback
  ? '../supabase/migrations/20260630130000_foot_customers_consent_marketing_additive.rollback.sql'
  : '../supabase/migrations/20260630130000_foot_customers_consent_marketing_additive.sql';
const SQL = readFileSync(join(__dir, file), 'utf8');

const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();

console.log(`🚀 customers.consent_marketing ${rollback ? 'ROLLBACK' : 'APPLY'} (T-20260630-foot-CUSTOMERS-CONSENT-MARKETING-COL)`);

const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ query: SQL }),
});
const body = await resp.json();
console.log('Status:', resp.status);
console.log('Response:', JSON.stringify(body, null, 2));
if (!resp.ok) { console.error('❌ 실패'); process.exit(1); }
console.log('✅ 완료');
