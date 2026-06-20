/* READ-ONLY introspection: audit CHECK constraint name + medical_charts RLS + helper fns */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let P = process.env.SUPABASE_DB_PASSWORD;
if (!P && fs.existsSync('.env')) for (const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const c=new Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
await c.connect();
const chk=await c.query(`SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='medical_charts_audit_log'::regclass AND contype='c'`);
console.log('=== audit_log CHECK constraints ==='); chk.rows.forEach(r=>console.log(`  ${r.conname}: ${r.def}`));
const pol=await c.query(`SELECT policyname, cmd, qual FROM pg_policies WHERE schemaname='public' AND tablename='medical_charts' ORDER BY cmd, policyname`);
console.log('\n=== medical_charts RLS policies ==='); pol.rows.forEach(r=>console.log(`  [${r.cmd}] ${r.policyname}\n      qual=${r.qual}`));
const fns=await c.query(`SELECT proname FROM pg_proc WHERE proname IN ('is_approved_user','is_director_or_admin','is_director','current_user_role') ORDER BY proname`);
console.log('\n=== helper fns present ==='); fns.rows.forEach(r=>console.log('  '+r.proname));
const idx=await c.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='medical_charts'`);
console.log('\n=== existing medical_charts indexes ==='); idx.rows.forEach(r=>console.log(`  ${r.indexname}`));
await c.end();
