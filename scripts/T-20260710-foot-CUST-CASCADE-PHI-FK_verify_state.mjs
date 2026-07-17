/**
 * T-20260710-foot-CUST-CASCADE-PHI-FK — PROD state verify (read-only)
 * re-routed GO (foot lane) 조건 재대조: 9 FK confdeltype='r' + ledger + orphan=0
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
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
  return { ok: resp.ok, body };
}
const rule = { a:'NOACTION', r:'RESTRICT', c:'CASCADE', n:'SETNULL' };
const CORE8 = ['clinical_images','treatment_photos','health_q_results','patient_past_history',
  'patient_file_records','customer_treatment_memos','customer_consult_memos','customer_special_notes'];
const TARGETS9 = [...CORE8, 'consultation_notes'];

console.log(`\n===== T-20260710 CUST-CASCADE-PHI-FK — PROD STATE VERIFY (read-only) — ${new Date().toISOString()} =====\n`);

// 1) 9 FK del rule
const st = await q(`SELECT chld.relname AS t, con.conname AS c, con.confdeltype AS d
  FROM pg_constraint con
  JOIN pg_class chld ON chld.oid=con.conrelid
  JOIN pg_class par ON par.oid=con.confrelid
  JOIN pg_namespace ns ON ns.oid=chld.relnamespace
 WHERE con.contype='f' AND ns.nspname='public' AND par.relname='customers'
   AND chld.relname = ANY(ARRAY['${TARGETS9.join("','")}']) ORDER BY chld.relname;`);
if (!st.ok) { console.error('❌ FK 조회 실패', JSON.stringify(st.body)); process.exit(1); }
const rows = st.body.result ?? st.body;
console.log('[1] 대상 9 FK del_rule (customers 부모):');
for (const r of rows) console.log(`   ${r.t.padEnd(28)} ${(rule[r.d]||r.d).padEnd(9)} ${r.c}`);
const present = new Set(rows.map(r=>r.t));
const missing = TARGETS9.filter(t=>!present.has(t));
const notRestrict = rows.filter(r=>r.d!=='r');
console.log(`   → 존재 ${rows.length}/9, 누락=[${missing.join(',')||'none'}], RESTRICT아님=[${notRestrict.map(r=>r.t).join(',')||'none'}]`);

// 2) ledger
const led = await q(`SELECT version FROM supabase_migrations.schema_migrations WHERE version LIKE '%20260710%' OR version LIKE '%CUST-CASCADE%' ORDER BY version;`);
console.log('\n[2] schema_migrations ledger (20260710/CUST-CASCADE):');
if (led.ok) { const lr = led.body.result ?? led.body; console.log(lr.length ? lr.map(r=>'   '+r.version).join('\n') : '   (없음)'); }
else console.log('   조회 실패:', JSON.stringify(led.body));

// 3) orphan on CORE8
const orphanSql = CORE8.map(t=>`SELECT '${t}' t, count(*) n FROM public.${t} c WHERE c.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers p WHERE p.id=c.customer_id)`).join('\nUNION ALL\n');
const orp = await q(orphanSql + ';');
console.log('\n[3] CORE PHI 8 orphan(customers 부재) count:');
if (orp.ok) { const orr = orp.body.result ?? orp.body; let tot=0; for (const r of orr){ console.log(`   ${r.t.padEnd(28)} ${r.n}`); tot+=Number(r.n);} console.log(`   → 합계 orphan=${tot}`); }
else console.log('   조회 실패:', JSON.stringify(orp.body));

// verdict
const allRestrict = rows.length===9 && notRestrict.length===0 && missing.length===0;
console.log(`\n===== VERDICT: ${allRestrict ? '✅ 9 FK 전부 RESTRICT (이미 apply 완료 상태)' : '⚠ 미완 — apply 필요'} =====\n`);
