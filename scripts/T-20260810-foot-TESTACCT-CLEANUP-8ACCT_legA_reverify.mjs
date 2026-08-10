// T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg A — READ-ONLY FK topology + freeze-set re-verify
// DELETE 0 · DDL 0 · WRITE 0. Confirms freeze-set unchanged since census f68b9613 before authoring destructive migration.
import { q } from './dryrun_lib.mjs';
const run = async (sql) => { const r = await q(sql); return r.result || r; };

// Leg A 6 targets ONLY (F-4990/F-5113/F-4574 = Leg B, excluded)
const TARGETS = {
  '21a82994-b231-4bcc-94ff-dd9e6c3a4951':'풋테스트3 F-4425',
  'e72022d0-7cf5-4f42-b5e3-b5162005b454':'풋테스트1 F-4427',
  'c074025b-cd27-443c-93a9-151d6d4214d4':'풋서류테스트입니다 F-4468',
  'd7faae9b-8e0b-421a-b68b-483ede6834a3':'송지현2 F-4692',
  'a0f8c846-9f93-47bf-a79e-57d265d989b6':'엄경은2 F-4691(clean)',
  '02594dfa-9428-4405-b640-95ab50ad5e5d':'엄경은2 F-4703(DUMMY)',
};
const ids = Object.keys(TARGETS);
const idlist = ids.map(i=>`'${i}'`).join(',');

// 1) confirm the 6 customer rows still exist + are the expected names (identity re-bind)
console.log('=== 1) TARGET CUSTOMER ROWS (identity re-bind) ===');
const cust = await run(`SELECT id::text, name, chart_number, visit_type, is_simulation, created_by
  FROM customers WHERE id IN (${idlist}) ORDER BY chart_number;`);
console.log(JSON.stringify(cust,null,2));
console.log(`rows=${cust.length} (expect 6)`);

// 2) FK topology: every table referencing public.customers + delete_rule
console.log('\n=== 2) FK -> customers (child_table, fk_column, delete_rule) ===');
const fk = await run(`
  SELECT tc.table_name AS child_table, kcu.column_name AS fk_column, rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name AND tc.table_schema=ccu.table_schema
  JOIN information_schema.referential_constraints rc ON tc.constraint_name=rc.constraint_name
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' AND ccu.table_name='customers'
  ORDER BY rc.delete_rule, tc.table_name;`);
console.log(JSON.stringify(fk,null,2));
const fkTables = new Set(fk.map(r=>r.child_table));

// 3) DYNAMIC: every public table with customer_id/patient_id column (FK or loose) — full recount per target
console.log('\n=== 3) ALL public tables with customer_id/patient_id column ===');
const cols = await run(`SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema='public' AND column_name IN ('customer_id','patient_id')
  AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')
  ORDER BY table_name;`);
const parts = [];
for (const {table_name:t, column_name:c} of cols) {
  parts.push(`SELECT '${t}' tbl, '${c}' col, ${c}::text cid, count(*) n FROM ${t} WHERE ${c} IN (${idlist}) GROUP BY ${c}`);
}
const rows = parts.length ? await run(parts.join('\nUNION ALL\n') + '\nORDER BY 3,1;') : [];

// pivot per customer + total-child count
const per = {}; for (const id of ids) per[id]={label:TARGETS[id],children:{}};
let grand=0;
for (const r of rows){ if(per[r.cid]){ per[r.cid].children[`${r.tbl}.${r.col}`]=Number(r.n); grand+=Number(r.n);} }
console.log('\n=== 4) PER-TARGET CHILD CENSUS (freeze-set) ===');
for (const id of ids){
  const c=per[id]; const kids=Object.entries(c.children);
  console.log(`--- ${c.label} [${id}]`);
  if(!kids.length) console.log('    children: NONE (fully clean)');
  else for(const [k,n] of kids.sort((a,b)=>b[1]-a[1])){
    const tbl=k.split('.')[0];
    const isFK=fkTables.has(tbl);
    console.log(`    ${isFK?'[FK]':'[loose]'} ${k}: ${n}`);
  }
}
console.log(`\nGRAND TOTAL child rows across 6 targets = ${grand}`);

// 5) LEDGER / medical guard: assert ZERO revenue/medical rows on Leg A targets (must be 0 to stay in Leg A)
console.log('\n=== 5) LEDGER/MEDICAL GUARD (must all be 0 for Leg A) ===');
const LEDGER=['payments','service_charges','package_payments','package_credit_ledger',
 'insurance_claims','insurance_documents','insurance_receipts','consultation_notes','medical_charts',
 'prescriptions','clinical_images','treatment_photos','consent_forms','patient_file_records','patient_past_history'];
const lparts = LEDGER.map(t=>`SELECT '${t}' tbl, count(*) n FROM ${t} WHERE customer_id IN (${idlist})`);
const lrows = await run(lparts.join('\nUNION ALL\n')+'\nORDER BY 1;');
let ledgerHits=0;
for(const r of lrows){ if(Number(r.n)>0){ ledgerHits+=Number(r.n); console.log(`  ★ NONZERO ${r.tbl}: ${r.n}`);} }
console.log(ledgerHits===0 ? '  ✓ ALL LEDGER/MEDICAL = 0 → Leg A eligible' : `  ✗ LEDGER HITS=${ledgerHits} → ABORT, escalate to (b)`);

console.log('\n=== DONE (READ-ONLY: 0 writes) ===');
