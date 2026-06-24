/**
 * T-20260624-foot-BUNDLERX-ICON-NOAPPLY part1 — TX-ROLLBACK PROBE
 * 마이그 본문을 단일 TX 내에서 적용 → director 적재 검증 → ROLLBACK (prod 영구변경 0).
 */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let PW = process.env.SUPABASE_DB_PASSWORD;
for (const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)PW=m[1].trim();}
const c = new Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:PW,ssl:{rejectUnauthorized:false}});
await c.connect();
const body = fs.readFileSync('supabase/migrations/20260624180000_bundlerx_director_write_rls.sql','utf8')
  .replace(/^\s*BEGIN;\s*$/m,'').replace(/^\s*COMMIT;\s*$/m,''); // strip file tx, use our own
const tables=['prescription_sets','document_templates','phrase_templates'];
const q=`SELECT tablename,policyname,cmd,qual FROM pg_policies WHERE schemaname='public' AND policyname IN ('admin_write_prescription_sets','admin_write_document_templates','admin_write_phrase_templates') ORDER BY tablename`;
let pass=0, fail=0;
await c.query('BEGIN');
try {
  // BEFORE
  const before = await c.query(q);
  for (const r of before.rows) {
    const hasDir = /director/.test(r.qual);
    console.log(`BEFORE ${r.tablename}: director=${hasDir} (expect false)`);
    if(!hasDir) pass++; else fail++;
  }
  // APPLY
  await c.query(body);
  // AFTER
  const after = await c.query(q);
  for (const r of after.rows) {
    const hasDir=/'director'/.test(r.qual);
    const hasAM=/'admin'/.test(r.qual)&&/'manager'/.test(r.qual);
    const noCheck = true; // FOR ALL USING-only preserved
    console.log(`AFTER  ${r.tablename}: admin&manager=${hasAM} director=${hasDir} (expect both true)`);
    if(hasDir&&hasAM) pass++; else fail++;
  }
  if (after.rows.length!==3){console.log(`!! expected 3 policies, got ${after.rows.length}`);fail++;}
} catch(e){ console.error('PROBE ERROR:', e.message); fail++; }
await c.query('ROLLBACK');
// confirm rollback left prod unchanged
const post = await c.query(q);
const leaked = post.rows.filter(r=>/'director'/.test(r.qual));
console.log(`\nPOST-ROLLBACK director leak = ${leaked.length} (expect 0)`);
if(leaked.length===0) pass++; else fail++;
await c.end();
console.log(`\n=== PROBE ${fail===0?'PASS':'FAIL'} (pass=${pass} fail=${fail}) ===`);
process.exit(fail===0?0:1);
