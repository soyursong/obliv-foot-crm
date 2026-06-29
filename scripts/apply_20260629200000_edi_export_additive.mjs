/**
 * T-20260629-foot-EDI-EXPORT-IMPL
 * edi_submissions export 메타(ADDITIVE nullable) + insurance_claim_items logical view.
 * Supabase Management API 경유 직접 실행 (대시보드 수동 실행 금지 정책).
 *
 * ⚠ supervisor DDL-diff 게이트 통과 후에만 실행. ADDITIVE nullable·DEFAULT 무 → blast 0.
 * rollback: node scripts/apply_20260629200000_edi_export_additive.mjs --rollback
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes('--rollback');
const file = rollback
  ? '../supabase/migrations/20260629200000_edi_export_additive.rollback.sql'
  : '../supabase/migrations/20260629200000_edi_export_additive.sql';
const SQL = readFileSync(join(__dir, file), 'utf8');

const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();

console.log(`🚀 EDI export 메타 ${rollback ? 'ROLLBACK' : 'APPLY'} (T-20260629-foot-EDI-EXPORT-IMPL)`);

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
