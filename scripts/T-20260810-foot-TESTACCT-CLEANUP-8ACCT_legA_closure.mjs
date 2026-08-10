// T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg A — READ-ONLY recursive FK-closure resolver.
// Walks FK graph from the 6 root customers, collecting every actual dependent row.
// Produces: per-table row PKs + topological delete order (deepest first). DELETE 0 / WRITE 0 / DDL 0.
import { q } from './dryrun_lib.mjs';
const run = async (sql) => { const r = await q(sql); return r.result || r; };

const ROOTS = {
  '21a82994-b231-4bcc-94ff-dd9e6c3a4951':'풋테스트3 F-4425',
  'e72022d0-7cf5-4f42-b5e3-b5162005b454':'풋테스트1 F-4427',
  'c074025b-cd27-443c-93a9-151d6d4214d4':'풋서류테스트입니다 F-4468',
  'd7faae9b-8e0b-421a-b68b-483ede6834a3':'송지현2 F-4692',
  'a0f8c846-9f93-47bf-a79e-57d265d989b6':'엄경은2 F-4691',
  '02594dfa-9428-4405-b640-95ab50ad5e5d':'엄경은2 F-4703',
};
const rootIds = Object.keys(ROOTS);

// full FK graph (public schema): child.col -> parent + delete_rule
const fkAll = await run(`
  SELECT tc.table_name AS child, kcu.column_name AS col, ccu.table_name AS parent, rc.delete_rule AS rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name AND tc.table_schema=ccu.table_schema
  JOIN information_schema.referential_constraints rc ON tc.constraint_name=rc.constraint_name
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
  ORDER BY ccu.table_name;`);

// PK column per table (assume single-col PK; fallback 'id')
const pkRows = await run(`
  SELECT tc.table_name AS tbl, kcu.column_name AS col
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
  WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public'
  ORDER BY tc.table_name, kcu.ordinal_position;`);
const pk = {}; for (const r of pkRows){ if(!pk[r.tbl]) pk[r.tbl]=r.col; }

// edges grouped by parent table
const edgesByParent = {};
for (const e of fkAll){ (edgesByParent[e.parent] ||= []).push(e); }

// closure: map table -> Set of PK ids to delete
const closure = { customers: new Set(rootIds) };
const edgeLog = [];        // {child,col,parent,rule,rows} for edges that hit rows
const setnullLog = [];     // SET NULL edges (won't be deleted, just nulled by pg)

// BFS over frontier
let frontier = [['customers', rootIds]];
let guard = 0;
while (frontier.length && guard++ < 500) {
  const next = [];
  for (const [parentTbl, parentIds] of frontier) {
    if (!parentIds.length) continue;
    const parentPk = pk[parentTbl] || 'id';
    const idl = parentIds.map(i=>`'${i}'`).join(',');
    for (const e of (edgesByParent[parentTbl]||[])) {
      // self-referential edges within same table (superseded_by etc.) — handle but avoid infinite loop
      const childPk = pk[e.child] || 'id';
      let rows;
      try {
        rows = await run(`SELECT DISTINCT ${childPk}::text AS pk FROM ${e.child} WHERE ${e.col} IN (${idl})`);
      } catch(err){ edgeLog.push({child:e.child,col:e.col,parent:e.parent,rule:e.rule,rows:'ERR:'+err.message.slice(0,40)}); continue; }
      const ids = rows.map(r=>r.pk).filter(Boolean);
      if (!ids.length) continue;
      if (e.rule === 'SET NULL') { setnullLog.push({child:e.child,col:e.col,parent:e.parent,n:ids.length}); continue; }
      edgeLog.push({child:e.child,col:e.col,parent:e.parent,rule:e.rule,rows:ids.length});
      const before = closure[e.child] ? closure[e.child].size : 0;
      closure[e.child] ||= new Set();
      const fresh=[];
      for (const id of ids){ if(!closure[e.child].has(id)){ closure[e.child].add(id); fresh.push(id);} }
      if (fresh.length) next.push([e.child, fresh]);
    }
  }
  frontier = next;
}

console.log('=== EDGES HIT (child.col -> parent [rule]: rows) ===');
for (const e of edgeLog) console.log(`  ${e.child}.${e.col} -> ${e.parent} [${e.rule}]: ${e.rows}`);
console.log('\n=== SET NULL edges (pg auto-nulls, not deleted) ===');
for (const s of setnullLog) console.log(`  ${s.child}.${s.col} -> ${s.parent}: ${s.n}`);

console.log('\n=== CLOSURE: tables & row counts to DELETE ===');
const tables = Object.keys(closure);
let total=0;
for (const t of tables.sort()){ const n=closure[t].size; total+=n; console.log(`  ${t} (pk=${pk[t]||'id'}): ${n}`); }
console.log(`  TOTAL rows in closure = ${total}`);

// topological delete order: a table must be deleted before any table it depends ON (i.e., children before parents)
// build dependency among closure tables from fkAll (child depends on parent for NO ACTION/RESTRICT/CASCADE)
const inClosure = new Set(tables);
const deps = {}; for (const t of tables) deps[t]=new Set();
for (const e of fkAll){
  if (e.child===e.parent) continue; // self-ref: ignore for ordering
  if (inClosure.has(e.child) && inClosure.has(e.parent) && e.rule!=='SET NULL'){
    deps[e.child].add(e.parent); // child must go before parent
  }
}
// Kahn: emit tables with no remaining in-closure children pointing... we want children first
const order=[]; const remaining=new Set(tables);
let g2=0;
while(remaining.size && g2++<500){
  // a table can be deleted if NO other remaining table depends ON it (i.e., it's not a parent of any remaining child)
  const parentsNeeded=new Set();
  for (const t of remaining) for (const p of deps[t]) if(remaining.has(p)) parentsNeeded.add(p);
  const emit=[...remaining].filter(t=>!parentsNeeded.has(t));
  if(!emit.length){ order.push('!! CYCLE: '+[...remaining].join(',')); break; }
  for (const t of emit.sort()){ order.push(t); remaining.delete(t); }
}
console.log('\n=== DELETE ORDER (children first) ===');
order.forEach((t,i)=>console.log(`  ${i+1}. ${t}`));

// also loose refs (no FK) — phi_access_log
const loose = await run(`SELECT count(*) n FROM phi_access_log WHERE customer_id IN (${rootIds.map(i=>`'${i}'`).join(',')})`);
console.log(`\n=== LOOSE (no FK): phi_access_log = ${(loose[0]||{}).n} rows (manual delete, no cascade) ===`);

// emit machine-readable closure for the migration authoring step
console.log('\n=== JSON_CLOSURE_BEGIN ===');
const out={};
for (const t of tables) out[t]={pk:pk[t]||'id', ids:[...closure[t]]};
console.log(JSON.stringify({closure:out, deleteOrder:order, phi_access_log_count:Number((loose[0]||{}).n||0)}));
console.log('=== JSON_CLOSURE_END ===');
