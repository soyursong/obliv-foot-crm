/**
 * T-20260625-foot-PHRASE-TEMPLATE-CRUD-FAIL — AC-0 READ-ONLY triage probe
 * Ground-truth from PROD:
 *  (1) 문지은 대표원장 user_profiles role/active
 *  (2) RLS policies on super_phrases / phrase_templates / document_templates (all cmds)
 *  (3) clinic_id column nullability on super_phrases
 * No writes. No tx mutation.
 */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let PW = process.env.SUPABASE_DB_PASSWORD;
for (const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)PW=m[1].trim();}
const c = new Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:PW,ssl:{rejectUnauthorized:false}});
await c.connect();

console.log('=== (1) user_profiles: 문지은 / 대표원장 / director enum ===');
const up = await c.query(`SELECT id, name, role, active FROM public.user_profiles WHERE name ILIKE '%문지은%' OR role='director' ORDER BY role`);
for (const r of up.rows) console.log(`  ${r.name} | role=${r.role} | active=${r.active} | id=${r.id}`);
const roleCounts = await c.query(`SELECT role, count(*) FROM public.user_profiles GROUP BY role ORDER BY role`);
console.log('  --- role distribution ---');
for (const r of roleCounts.rows) console.log(`  role=${r.role}: ${r.count}`);

console.log('\n=== (2) RLS policies on 3 target tables (ALL cmds) ===');
const pol = await c.query(`
  SELECT tablename, policyname, cmd, roles, qual, with_check
  FROM pg_policies
  WHERE schemaname='public' AND tablename IN ('super_phrases','phrase_templates','document_templates')
  ORDER BY tablename, cmd, policyname`);
let cur='';
for (const r of pol.rows) {
  if (r.tablename!==cur){ console.log(`\n  --- ${r.tablename} ---`); cur=r.tablename; }
  console.log(`  [${r.cmd}] ${r.policyname} roles=${r.roles}`);
  console.log(`        USING: ${(r.qual||'').replace(/\s+/g,' ').slice(0,180)}`);
  if (r.with_check) console.log(`        CHECK: ${r.with_check.replace(/\s+/g,' ').slice(0,180)}`);
}
console.log(`\n  (total policies on 3 tables: ${pol.rows.length})`);

console.log('\n=== (3) super_phrases columns (clinic_id nullability) ===');
const cols = await c.query(`
  SELECT column_name, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='super_phrases' ORDER BY ordinal_position`);
for (const r of cols.rows) console.log(`  ${r.column_name} | nullable=${r.is_nullable} | default=${r.column_default||'—'}`);

console.log('\n=== (4) RLS enabled? ===');
const rls = await c.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('super_phrases','phrase_templates','document_templates') AND relnamespace='public'::regnamespace`);
for (const r of rls.rows) console.log(`  ${r.relname}: rowsecurity=${r.relrowsecurity}`);

await c.end();
console.log('\n=== AC-0 PROBE DONE (read-only) ===');
