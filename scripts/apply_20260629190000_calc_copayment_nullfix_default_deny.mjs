/**
 * T-20260629-foot-COPAYCALC-SERVER-NULLFIX
 * calc_copayment v1.2 — NULL분기 default-deny allowlist + data_incomplete 컬럼.
 * Supabase Management API 경유 직접 실행 (대시보드 수동 실행 금지 정책).
 *
 * ⚠ supervisor DDL-diff 게이트 통과 후에만 실행. RETURNS TABLE 컬럼 추가(ADDITIVE)
 *    이지만 Postgres return-type 변경 제약으로 마이그/롤백 모두 DROP+CREATE 동반.
 * rollback: node scripts/apply_20260629190000_...mjs --rollback
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes('--rollback');
const file = rollback
  ? '../supabase/migrations/20260629190000_calc_copayment_nullfix_default_deny.rollback.sql'
  : '../supabase/migrations/20260629190000_calc_copayment_nullfix_default_deny.sql';
const SQL = readFileSync(join(__dir, file), 'utf8');

const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();

console.log(`🚀 calc_copayment ${rollback ? 'ROLLBACK → v1.1' : 'APPLY → v1.2'} (T-20260629-foot-COPAYCALC-SERVER-NULLFIX)`);

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
