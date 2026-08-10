// Part 2 (throttle-paced): Leg A-(b) closure + ledger/medical guard + Leg B infra.
import { q } from './dryrun_lib.mjs';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (sql) => { for(let a=0;a<6;a++){ try{ const r=await q(sql); await sleep(350); return r.result||r; } catch(e){ if(/429/.test(e.message)){ await sleep(4000); continue;} throw e; } } throw new Error('retry-exhausted'); };
const ql = a => a.map(i=>`'${i}'`).join(',');
const LEG_A_B = ['21a82994-b231-4bcc-94ff-dd9e6c3a4951','d7faae9b-8e0b-421a-b68b-483ede6834a3']; // F-4425,F-4692
const LEG_A_A = ['a0f8c846-9f93-47bf-a79e-57d265d989b6','02594dfa-9428-4405-b640-95ab50ad5e5d','c074025b-cd27-443c-93a9-151d6d4214d4'];
const LEG_B   = ['e72022d0-7cf5-4f42-b5e3-b5162005b454','66c08e48-c708-4e50-963d-aaa56b27d9ea']; // F-4427,F-4445

const fkAll = await run(`SELECT tc.table_name AS child, kcu.column_name AS col, ccu.table_name AS parent, rc.delete_rule AS rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name AND tc.table_schema=ccu.table_schema
  JOIN information_schema.referential_constraints rc ON tc.constraint_name=rc.constraint_name
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' ORDER BY ccu.table_name;`);
const pkRows = await run(`SELECT tc.table_name AS tbl, kcu.column_name AS col FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
  WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public' ORDER BY tc.table_name, kcu.ordinal_position;`);
const pk={}; for(const r of pkRows){ if(!pk[r.tbl]) pk[r.tbl]=r.col; }
const edgesByParent={}; for(const e of fkAll){ (edgesByParent[e.parent] ||= []).push(e); }

async function closureOf(rootIds){
  const closure={customers:new Set(rootIds)}; const setnull=[];
  let frontier=[['customers',rootIds]]; let guard=0;
  while(frontier.length && guard++<500){ const next=[];
    for(const [ptbl,pids] of frontier){ if(!pids.length) continue; const idl=pids.map(i=>`'${i}'`).join(',');
      for(const e of (edgesByParent[ptbl]||[])){ const childPk=pk[e.child]||'id'; let rows;
        try{ rows=await run(`SELECT DISTINCT ${childPk}::text AS pk FROM ${e.child} WHERE ${e.col} IN (${idl})`);}catch(err){continue;}
        const ids=rows.map(r=>r.pk).filter(Boolean); if(!ids.length) continue;
        if(e.rule==='SET NULL'){ setnull.push(`${e.child}.${e.col}(${ids.length})`); continue; }
        closure[e.child] ||= new Set(); const fresh=[];
        for(const id of ids){ if(!closure[e.child].has(id)){ closure[e.child].add(id); fresh.push(id);} }
        if(fresh.length) next.push([e.child,fresh]); } }
    frontier=next; }
  const tables=Object.keys(closure); const inC=new Set(tables); const deps={};
  for(const t of tables) deps[t]=new Set();
  for(const e of fkAll){ if(e.child===e.parent) continue; if(inC.has(e.child)&&inC.has(e.parent)&&e.rule!=='SET NULL') deps[e.child].add(e.parent); }
  const order=[]; const rem=new Set(tables); let g2=0;
  while(rem.size&&g2++<500){ const need=new Set(); for(const t of rem) for(const p of deps[t]) if(rem.has(p)) need.add(p);
    const emit=[...rem].filter(t=>!need.has(t)); if(!emit.length){order.push('CYCLE');break;} for(const t of emit.sort()){order.push(t);rem.delete(t);} }
  const loose=await run(`SELECT count(*) n FROM phi_access_log WHERE customer_id IN (${rootIds.map(i=>`'${i}'`).join(',')})`);
  return {closure,order,setnull,phi:Number((loose[0]||{}).n||0)};
}

console.log('=== FK CLOSURE — LEG A-(b) Path-B [F-4425,F-4692] ===');
const {closure,order,setnull,phi}=await closureOf(LEG_A_B);
let total=0; const out={};
for(const t of Object.keys(closure).sort()){ const n=closure[t].size; total+=n; out[t]={pk:pk[t]||'id',n,ids:[...closure[t]]}; console.log(`  ${t}: ${n}`); }
console.log(`  phi_access_log (loose): ${phi}`);
console.log(`  TOTAL closure = ${total} (+phi ${phi} = ${total+phi})`);
console.log(`  SET NULL: ${setnull.join(', ')||'none'}`);
console.log(`  DELETE ORDER: ${order.join(' → ')}`);
console.log('  JSON_AB_BEGIN'); console.log(JSON.stringify({closure:out,order,phi})); console.log('  JSON_AB_END');

console.log('\n=== LEDGER/MEDICAL GUARD (A-a + A-b purge set must be 0) ===');
for(const t of ['payments','service_charges','package_payments','package_credit_ledger','medical_charts','prescriptions','consent_forms','insurance_claims']){
  try{ const has=await run(`SELECT count(*) n FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}' AND column_name='customer_id'`);
    if(Number((has[0]||{}).n)===0){ console.log(`  ${t}: (no customer_id — skip)`); continue; }
    const r=await run(`SELECT count(*) n FROM ${t} WHERE customer_id IN (${ql([...LEG_A_A,...LEG_A_B])})`); console.log(`  ${t}: ${(r[0]||{}).n}`);
  }catch(err){ console.log(`  ${t}: ERR ${err.message.slice(0,40)}`); }
}

console.log('\n=== LEG B is_test INFRA (prod) ===');
const col=await run(`SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='is_test'`);
console.log(`  customers.is_test: ${col.length?JSON.stringify(col[0]):'✗ ABSENT'}`);
const flagged=await run(`SELECT chart_number,name FROM customers WHERE is_test=true ORDER BY chart_number`);
console.log(`  is_test=true now (${flagged.length}): ${flagged.map(r=>r.chart_number+' '+r.name).join(', ')}`);
const t2=await run(`SELECT chart_number,name,is_test FROM customers WHERE id IN (${ql(LEG_B)}) ORDER BY chart_number`);
for(const r of t2) console.log(`  Leg B target ${r.chart_number} ${r.name}: is_test=${r.is_test} (expect false→true)`);
const vdr=await run(`SELECT pg_get_viewdef('public.v_daily_revenue'::regclass) AS def`);
console.log(`  v_daily_revenue refs is_test: ${/is_test/.test((vdr[0]||{}).def||'')}`);
console.log('\n=== P2 DONE (READ-ONLY) ===');
