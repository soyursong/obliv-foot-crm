/**
 * T-20260720-foot-AICC-ANON-PII-LEAK — AC1 usage-baseline positive-control (READ-ONLY).
 * Management API 경유. 어떤 DDL/DML 도 실행하지 않는다(introspect + SET LOCAL ROLE anon positive-control, ROLLBACK).
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; }));
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN required');
async function q(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }) });
  const body = await resp.json();
  if (!resp.ok) { console.error('❌', JSON.stringify(body)); process.exit(1); }
  return body;
}
console.log('═══ AC1 usage-baseline (obliv-foot-crm '+PROJ_REF+') READ-ONLY ═══\n');

console.log('[1] aicc_crm_phone_match 뷰 anon privs:');
const vp = await q(`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee='anon' AND table_schema='public' AND table_name='aicc_crm_phone_match' ORDER BY privilege_type;`);
console.log('   anon privs:', vp.map(r=>r.privilege_type).join(',') || '(none)');

console.log('\n[2] customers anon privs + RLS:');
const cp = await q(`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee='anon' AND table_schema='public' AND table_name='customers' ORDER BY privilege_type;`);
console.log('   anon privs:', cp.map(r=>r.privilege_type).join(',') || '(none)');
const rls = await q(`SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='customers';`);
console.log('   RLS enabled:', rls[0]?.relrowsecurity);

console.log('\n[3] customers anon 정책 (cmd/qual):');
const pol = await q(`SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='customers' AND roles::text LIKE '%anon%' ORDER BY policyname;`);
pol.forEach(p=>console.log('   ['+p.cmd+']', p.policyname, '| USING:', p.qual, '| WITH CHECK:', p.with_check));
if(!pol.length) console.log('   (anon 정책 없음)');

console.log('\n[4] resolve_v3 SECDEF + anon EXECUTE:');
const fn = await q(`SELECT p.prosecdef, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_selfcheckin_upsert_customer_resolve_v3';`);
fn.forEach(f=>console.log('   SECURITY DEFINER:', f.prosecdef, '| anon EXECUTE:', f.anon_exec));

console.log('\n[5] viewdef (name/phone 투영 확인):');
const vd = await q(`SELECT pg_get_viewdef('public.aicc_crm_phone_match'::regclass, true) AS def;`);
console.log('   ', (vd[0]?.def||'').replace(/\s+/g,' ').trim());

console.log('\n[6] POSITIVE-CONTROL: anon 역할로 customers name+phone 실-읽기 (txn ROLLBACK):');
const pc = await q(`DO $$ DECLARE v_total int; v_reach int; BEGIN
  SELECT count(*) INTO v_total FROM public.customers;
  RAISE NOTICE 'postgres total=%', v_total;
END $$;
SELECT count(*) AS total_asowner FROM public.customers;`);
console.log('   owner total:', pc[pc.length-1]?.[0]?.total_asowner ?? JSON.stringify(pc.slice(-1)));

// anon SET ROLE positive-control — single txn, RESET (no persistence)
const pcAnon = await q(`SET ROLE anon;
SELECT count(*) AS anon_reach, count(name) AS anon_name, count(phone) AS anon_phone FROM public.customers;`);
console.log('   ANON reach (name+phone 읽기 도달):', JSON.stringify(pcAnon[pcAnon.length-1]));
await q(`RESET ROLE;`);

// anon reach via the aicc view too
const pcView = await q(`SET ROLE anon;
SELECT count(*) AS anon_view_reach FROM public.aicc_crm_phone_match;`);
console.log('   ANON reach via aicc 뷰:', JSON.stringify(pcView[pcView.length-1]));
await q(`RESET ROLE;`);

console.log('\n═══ probe 완료 (무영속 — DDL/DML 0) ═══');
