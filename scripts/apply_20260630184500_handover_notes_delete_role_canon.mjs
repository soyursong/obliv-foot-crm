/**
 * T-20260630-foot-HANDOVER-DELETE-PERSIST — PROD 마이그 적용 + 증거기반 probe.
 * FIX-REQUEST MSG-20260630-184013-11j6 (supervisor): commit 34784101 코드는 merge,
 *   db_change:true 마이그는 git merge 만으로 PROD 미적용 → 본 스크립트로 직접 적용.
 * 흐름: probe-before(회귀상태 캡처) → apply(DELETE 정책 canon 정렬) → probe-after(실재 확인).
 * rollback: supabase/migrations/20260630184500_handover_notes_delete_role_canon.rollback.sql
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(__dir, '../supabase/migrations/20260630184500_handover_notes_delete_role_canon.sql'), 'utf8');
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { try {
       const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
       if (env.SUPABASE_ACCESS_TOKEN) return env.SUPABASE_ACCESS_TOKEN;
     } catch {} throw new Error('SUPABASE_ACCESS_TOKEN required'); })();

async function q(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }) });
  const body = await resp.json();
  if (!resp.ok) { console.error('❌ query 실패:', JSON.stringify(body, null, 2)); process.exit(1); }
  return body;
}

const PROBE_POLICIES = `
  select schemaname, tablename, policyname, cmd, qual
  from pg_policies
  where tablename in ('handover_notes','handover_checklist_items')
    and cmd = 'DELETE'
  order by tablename, policyname;`;

const PROBE_HELPER = `
  select p.proname, p.prosecdef as security_definer,
         pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'is_admin_or_manager';`;

console.log('═══ T-20260630-foot-HANDOVER-DELETE-PERSIST PROD 적용 ═══');
console.log('proj:', PROJ_REF, '(crm-obliv-foot)\n');

console.log('── [1] probe-before: DELETE 정책 현황 (회귀 상태 캡처) ──');
console.log(JSON.stringify((await q(PROBE_POLICIES)).slice?.(0) ?? await q(PROBE_POLICIES), null, 2));

console.log('\n── [2] probe: is_admin_or_manager() 헬퍼 실재 ──');
console.log(JSON.stringify(await q(PROBE_HELPER), null, 2));

console.log('\n── [3] apply: 마이그 20260630184500 실행 ──');
await q(SQL);
console.log('✅ apply 완료');

console.log('\n── [4] probe-after: DELETE 정책 canon 정렬 확인 ──');
const after = await q(PROBE_POLICIES);
console.log(JSON.stringify(after, null, 2));

const arr = Array.isArray(after) ? after : (after.result || []);
const ok = arr.length === 2
  && arr.every(p => /is_admin_or_manager\(\)/.test(p.qual || ''))
  && arr.some(p => p.tablename === 'handover_notes')
  && arr.some(p => p.tablename === 'handover_checklist_items');
console.log('\n═══ VERDICT:', ok ? '✅ PASS — 양 DELETE 정책 is_admin_or_manager() canon 적용 확인'
                              : '❌ FAIL — 기대 정책/함수 참조 미확인', '═══');
process.exit(ok ? 0 : 1);
