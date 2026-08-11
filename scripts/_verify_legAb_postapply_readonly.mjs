// READ-ONLY post-apply verify — Leg A-(b) Path-B. DELETE 0 · WRITE 0 · DDL 0.
import { q } from './dryrun_lib.mjs';
const run = async (sql) => { const r = await q(sql); return r.result || r; };
const P = (label, val, exp) => console.log(`${val===exp?'✅':'❌'} ${label}: ${val} (expect ${exp})`);

const c = await run(`SELECT count(*)::int n FROM customers WHERE id IN ('21a82994-b231-4bcc-94ff-dd9e6c3a4951','d7faae9b-8e0b-421a-b68b-483ede6834a3');`);
P('live target customers (F-4425/F-4692)', c[0].n, 0);

const f = await run(`SELECT count(*)::int n FROM form_submissions WHERE id::text LIKE 'b0edd82a%' OR id::text LIKE '755ac489%';`);
P('live target form_submissions (draft+voided)', f[0].n, 0);

const k = await run(`SELECT count(*)::int n FROM customers WHERE id='e72022d0-7cf5-4f42-b5e3-b5162005b454';`);
P('F-4427 customer survives (scope 밖)', k[0].n, 1);
const kf = await run(`SELECT count(*)::int n FROM form_submissions WHERE id::text LIKE 'b4a36c4e%';`);
P('F-4427 fs (b4a36c4e) survives', kf[0].n, 1);

const t = await run(`SELECT tgenabled FROM pg_trigger WHERE tgname='trg_form_submissions_published_immutable';`);
P("trg published_immutable tgenabled='O'", t.length?t[0].tgenabled:'ABSENT', 'O');

const at = await run(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '_arch_testacct8_ab_%';`);
P('archive tables _arch_testacct8_ab_*', at[0].n, 17);
const names = await run(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '_arch_testacct8_ab_%' ORDER BY 1;`);
const parts = names.map(r=>`SELECT '${r.table_name}' t, count(*)::int n FROM ${r.table_name}`);
const rows = await run(parts.join('\nUNION ALL\n')+'\nORDER BY 1;');
const total = rows.reduce((s,r)=>s+r.n,0);
P('archive total rows', total, 91);
console.log('--- per-table archive ---');
rows.forEach(r=>console.log(`  ${r.t}: ${r.n}`));
