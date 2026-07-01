/**
 * T-20260629-foot-STAFF-ROTATION-DEFAULT-ORDER (P1)
 * staff.assign_sort_order INTEGER nullable — ADDITIVE 1컬럼 + 현장 확정 순번 seed.
 * Supabase Management API 경유 직접 실행 (대시보드 수동 실행 금지 정책).
 *
 * ⚠ supervisor DDL-diff 게이트 + data-architect CONSULT GO(순수 ADDITIVE,
 *   DA-20260629-foot-STAFF-ROTATION-DEFAULT-ORDER, schema_registry v1.18.3) 후 prod 적용.
 *   ADD COLUMN IF NOT EXISTS + UPDATE …IS NULL 가드 = 멱등(재실행 안전).
 * FIX-REQUEST MSG-20260701-135805-evc4 (supervisor, qa_fail=db_migration_pending) 처리.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dir, '../supabase/migrations/20260629120000_staff_assign_sort_order.sql'),
  'utf8'
);

const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();

console.log('🚀 staff.assign_sort_order APPLY (T-20260629-foot-STAFF-ROTATION-DEFAULT-ORDER)');

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
