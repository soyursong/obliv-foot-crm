/**
 * T-20260703-foot-STAFFPHOTO-CHART-LINK
 * canonical treatment_photos 테이블 + private 'treatment-photos' 버킷 + RLS(테이블/storage 미러).
 * Supabase Management API 경유 직접 실행 (대시보드 수동 실행 금지 정책).
 *
 * ⚠ supervisor DDL-diff PHI DB-GATE 통과 후에만 실행. ADDITIVE(신설, blast 0)이나 PHI 테이블 → 게이트 대상.
 * rollback: node scripts/apply_20260703170000_foot_treatment_photos_staff_capture.mjs --rollback
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes('--rollback');
const file = rollback
  ? '../supabase/migrations/20260703170000_foot_treatment_photos_staff_capture.rollback.sql'
  : '../supabase/migrations/20260703170000_foot_treatment_photos_staff_capture.sql';
const SQL = readFileSync(join(__dir, file), 'utf8');

const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();

console.log(`🚀 treatment_photos staff-capture ${rollback ? 'ROLLBACK' : 'APPLY'} (T-20260703-foot-STAFFPHOTO-CHART-LINK)`);

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
