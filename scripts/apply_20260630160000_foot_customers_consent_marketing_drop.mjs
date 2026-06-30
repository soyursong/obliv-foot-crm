/**
 * T-20260630-foot-CONSENT-MARKETING-COL-ROLLBACK
 * customers.consent_marketing DROP — 비-SSOT divergent 명칭 수렴 복원 (DA NO-GO as-named).
 * Supabase Management API 경유 직접 실행 (대시보드 수동 실행 금지 정책).
 *
 * ⚠ 선행 게이트 (DA-prescribed, 역전 금지):
 *   가드A 큐 드레인 0 → 가드B EF 참조 동반 제거 → ★HARD pre-DROP count(*)=0 → DROP.
 *   본 스크립트는 DROP 실행만 담당. pre-DROP count 게이트는 별도 SQL 로 선행 확인.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dir, '../supabase/migrations/20260630160000_foot_customers_consent_marketing_drop_convergence.sql'),
  'utf8',
);

const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();

console.log('🚀 customers.consent_marketing DROP (T-20260630-foot-CONSENT-MARKETING-COL-ROLLBACK)');

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
