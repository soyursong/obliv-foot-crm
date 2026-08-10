// T-20260810-foot-TESTACCT-CLEANUP-8ACCT — 3-leg split READ-ONLY census + FK closure.
// planner NEW-TASK MSG-20260811-082849-425f (총괄 '완전정리' erase-의도 게이트 RESOLVED).
// DELETE 0 / WRITE 0 / DDL 0 — SELECT/introspection only (Management API READ-ONLY).
//
// Produces per-leg closure counts so each leg's own migration has exact-N POSTCHECK,
// re-binds identity (chart_number ↔ id ↔ name) for freeze-set safety, verifies
// form_submissions status/serial per account, and confirms Leg B is_test infra on prod.
import { q } from './dryrun_lib.mjs';
const run = async (sql) => { const r = await q(sql); return r.result || r; };

// ── canonical roster (chart_number → id), from AC-1 census (commit f68b9613) + F-4445 (4jg4) ──
const ROSTER = {
  'F-4691': { id:'a0f8c846-9f93-47bf-a79e-57d265d989b6', name:'엄경은2',        leg:'A-a' },
  'F-4703': { id:'02594dfa-9428-4405-b640-95ab50ad5e5d', name:'엄경은2(DUMMY)', leg:'A-a' },
  'F-4468': { id:'c074025b-cd27-443c-93a9-151d6d4214d4', name:'풋서류테스트입니다', leg:'A-a' },
  'F-4425': { id:'21a82994-b231-4bcc-94ff-dd9e6c3a4951', name:'풋테스트3',      leg:'A-b' },
  'F-4692': { id:'d7faae9b-8e0b-421a-b68b-483ede6834a3', name:'송지현2',        leg:'A-b' },
  'F-4427': { id:'e72022d0-7cf5-4f42-b5e3-b5162005b454', name:'풋테스트1',      leg:'B'   },
  'F-4445': { id:'66c08e48-c708-4e50-963d-aaa56b27d9ea', name:'박민석',         leg:'B'   },
};
const LEG_A_A = ['F-4691','F-4703','F-4468'].map(c=>ROSTER[c].id);
const LEG_A_B = ['F-4425','F-4692'].map(c=>ROSTER[c].id);
const LEG_B   = ['F-4427','F-4445'].map(c=>ROSTER[c].id);
const ql = a => a.map(i=>`'${i}'`).join(',');

// ── 1) identity re-bind (freeze-set safety: chart↔id↔name still consistent, no drift) ──
console.log('=== 1) IDENTITY RE-BIND (freeze-set) ===');
const idRows = await run(`SELECT id::text, chart_number, name, is_test, is_simulation, created_by,
  to_char(created_at,'YYYY-MM-DD') AS created FROM customers
  WHERE id IN (${ql(Object.values(ROSTER).map(r=>r.id))}) ORDER BY chart_number`);
for (const r of idRows){
  const exp = Object.entries(ROSTER).find(([c,v])=>v.id===r.id);
  const ok = exp && exp[0]===r.chart_number && exp[1].name===r.name;
  console.log(`  ${r.chart_number} ${r.name} is_test=${r.is_test} is_sim=${r.is_simulation} created_by=${r.created_by} created=${r.created}  ${ok?'✓bind':'✗MISMATCH'}`);
}
console.log(`  rows=${idRows.length} (expect 7)`);

// ── 2) real-customer disambiguation guard (name collision but different id must be EXCLUDED) ──
console.log('\n=== 2) NAME-COLLISION EXCLUSION (동명이인 실고객 배제) ===');
const collide = await run(`SELECT chart_number, name, id::text FROM customers
  WHERE name IN ('송지현','엄경은','송지현2','엄경은2','박민석','풋테스트1','풋테스트3')
  AND id NOT IN (${ql(Object.values(ROSTER).map(r=>r.id))}) ORDER BY name, chart_number`);
console.log(`  non-target same/similar-name rows (must be untouched): ${collide.length}`);
for (const r of collide) console.log(`   · KEEP ${r.chart_number} ${r.name} (${r.id})`);

// ── 3) form_submissions status/serial per account ──
console.log('\n=== 3) form_submissions (retention-guard axis) ===');
const fs = await run(`SELECT c.chart_number, f.id::text AS fs_id, f.status, f.doc_serial_seq
  FROM form_submissions f JOIN customers c ON c.id=f.customer_id
  WHERE f.customer_id IN (${ql(Object.values(ROSTER).map(r=>r.id))}) ORDER BY c.chart_number`);
if (!fs.length) console.log('  (none)');
for (const r of fs) console.log(`  ${r.chart_number}: fs=${r.fs_id} status=${r.status} doc_serial_seq=${r.doc_serial_seq}`);

// ── 4) recursive FK closure per leg ──
const fkAll = await run(`
  SELECT tc.table_name AS child, kcu.column_name AS col, ccu.table_name AS parent, rc.delete_rule AS rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name AND tc.table_schema=ccu.table_schema
  JOIN information_schema.referential_constraints rc ON tc.constraint_name=rc.constraint_name
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' ORDER BY ccu.table_name;`);
const pkRows = await run(`SELECT tc.table_name AS tbl, kcu.column_name AS col
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
  WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public' ORDER BY tc.table_name, kcu.ordinal_position;`);
const pk = {}; for (const r of pkRows){ if(!pk[r.tbl]) pk[r.tbl]=r.col; }
const edgesByParent = {}; for (const e of fkAll){ (edgesByParent[e.parent] ||= []).push(e); }

async function closureOf(rootIds){
  const closure = { customers: new Set(rootIds) };
  const setnull = []; const edgeLog = [];
  let frontier = [['customers', rootIds]]; let guard=0;
  while (frontier.length && guard++ < 500){
    const next=[];
    for (const [ptbl, pids] of frontier){
      if(!pids.length) continue;
      const idl = pids.map(i=>`'${i}'`).join(',');
      for (const e of (edgesByParent[ptbl]||[])){
        const childPk = pk[e.child]||'id';
        let rows; try{ rows = await run(`SELECT DISTINCT ${childPk}::text AS pk FROM ${e.child} WHERE ${e.col} IN (${idl})`); }
        catch(err){ edgeLog.push(`${e.child}.${e.col} ERR ${err.message.slice(0,30)}`); continue; }
        const ids = rows.map(r=>r.pk).filter(Boolean); if(!ids.length) continue;
        if (e.rule==='SET NULL'){ setnull.push(`${e.child}.${e.col} (${ids.length})`); continue; }
        closure[e.child] ||= new Set(); const fresh=[];
        for (const id of ids){ if(!closure[e.child].has(id)){ closure[e.child].add(id); fresh.push(id); } }
        if(fresh.length) next.push([e.child, fresh]);
      }
    }
    frontier=next;
  }
  // topo order (children first)
  const tables=Object.keys(closure); const inC=new Set(tables); const deps={};
  for(const t of tables) deps[t]=new Set();
  for(const e of fkAll){ if(e.child===e.parent) continue;
    if(inC.has(e.child)&&inC.has(e.parent)&&e.rule!=='SET NULL') deps[e.child].add(e.parent); }
  const order=[]; const rem=new Set(tables); let g2=0;
  while(rem.size && g2++<500){ const need=new Set();
    for(const t of rem) for(const p of deps[t]) if(rem.has(p)) need.add(p);
    const emit=[...rem].filter(t=>!need.has(t)); if(!emit.length){ order.push('CYCLE'); break; }
    for(const t of emit.sort()){ order.push(t); rem.delete(t); } }
  const loose = await run(`SELECT count(*) n FROM phi_access_log WHERE customer_id IN (${rootIds.map(i=>`'${i}'`).join(',')})`);
  return { closure, order, setnull, edgeLog, phi: Number((loose[0]||{}).n||0) };
}

for (const [label, roots] of [['LEG A-(a) 정상삭제 [F-4691,F-4703,F-4468]', LEG_A_A],
                              ['LEG A-(b) Path-B [F-4425,F-4692]', LEG_A_B]]){
  console.log(`\n=== 4) FK CLOSURE — ${label} ===`);
  const { closure, order, setnull, phi } = await closureOf(roots);
  let total=0; const out={};
  for (const t of Object.keys(closure).sort()){ const n=closure[t].size; total+=n; out[t]={pk:pk[t]||'id', n, ids:[...closure[t]]}; console.log(`  ${t}: ${n}`); }
  console.log(`  phi_access_log (loose): ${phi}`);
  console.log(`  TOTAL closure rows = ${total} (+phi ${phi} = ${total+phi})`);
  console.log(`  SET NULL edges: ${setnull.join(', ')||'none'}`);
  console.log(`  DELETE ORDER: ${order.join(' → ')}`);
  console.log(`  JSON_${roots===LEG_A_A?'AA':'AB'}_BEGIN`); console.log(JSON.stringify({closure:out, order, phi})); console.log(`  JSON_${roots===LEG_A_A?'AA':'AB'}_END`);
}

// ── 5) financial / medical guard per leg (must be 0 for purge-eligible) ──
console.log('\n=== 5) LEDGER/MEDICAL GUARD (purge legs A-a,A-b must be 0) ===');
const guardTables = ['payments','service_charges','package_payments','package_credit_ledger',
  'medical_charts','prescriptions','consent_forms','insurance_claims'];
for (const t of guardTables){
  let col='customer_id';
  try{
    const has = await run(`SELECT count(*) n FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}' AND column_name='customer_id'`);
    if(Number((has[0]||{}).n)===0){ console.log(`  ${t}: (no customer_id col — skip)`); continue; }
    const r = await run(`SELECT count(*) n FROM ${t} WHERE customer_id IN (${ql([...LEG_A_A,...LEG_A_B])})`);
    console.log(`  ${t}: ${(r[0]||{}).n}`);
  }catch(err){ console.log(`  ${t}: ERR ${err.message.slice(0,40)}`); }
}

// ── 6) Leg B is_test infra existence on prod (applied 01:08) ──
console.log('\n=== 6) LEG B is_test INFRA (prod, applied 2026-08-11 01:08) ===');
const col = await run(`SELECT data_type, is_nullable, column_default FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers' AND column_name='is_test'`);
console.log(`  customers.is_test: ${col.length? JSON.stringify(col[0]) : '✗ ABSENT (infra not applied on prod!)'}`);
const flagged = await run(`SELECT chart_number, name FROM customers WHERE is_test=true ORDER BY chart_number`);
console.log(`  currently is_test=true (${flagged.length}): ${flagged.map(r=>r.chart_number+' '+r.name).join(', ')}`);
const legBtargets = await run(`SELECT chart_number, name, is_test FROM customers WHERE id IN (${ql(LEG_B)}) ORDER BY chart_number`);
console.log('  Leg B flag targets (F-4427,F-4445) current is_test:');
for (const r of legBtargets) console.log(`   · ${r.chart_number} ${r.name}: is_test=${r.is_test} (expect false → flip to true)`);
const vdr = await run(`SELECT pg_get_viewdef('public.v_daily_revenue'::regclass) AS def`);
console.log(`  v_daily_revenue references is_test: ${/is_test/.test((vdr[0]||{}).def||'')}`);

console.log('\n=== CENSUS DONE (READ-ONLY · DELETE 0 · WRITE 0 · DDL 0) ===');
