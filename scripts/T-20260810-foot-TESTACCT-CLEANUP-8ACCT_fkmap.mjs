import { q } from './dryrun_lib.mjs';
const run = async (sql) => { const r = await q(sql); return r.result || r; };

console.log('=== Tables with FK referencing public.customers ===');
const fk = await run(`
  SELECT tc.table_name AS child_table, kcu.column_name AS fk_column, rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name AND tc.table_schema=ccu.table_schema
  JOIN information_schema.referential_constraints rc ON tc.constraint_name=rc.constraint_name
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' AND ccu.table_name='customers'
  ORDER BY tc.table_name;`);
console.log(JSON.stringify(fk,null,2));

console.log('\n=== Any table (public) with a column named customer_id (FK or loose) ===');
const cc = await run(`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema='public' AND column_name IN ('customer_id','patient_id')
  ORDER BY table_name;`);
console.log(JSON.stringify(cc,null,2));

console.log('\n=== namesake check: real 송지현 / 엄경은 (WITHOUT "2") ===');
const ns = await run(`
  SELECT id,name,phone,chart_number,created_at,visit_type
  FROM customers
  WHERE normalize(name,NFC) IN (normalize('송지현',NFC),normalize('엄경은',NFC))
  ORDER BY name,created_at;`);
console.log(JSON.stringify(ns,null,2));
