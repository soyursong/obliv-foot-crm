/**
 * T-20260625-foot-PHRASE-TEMPLATE-CRUD-FAIL — TX-ROLLBACK PROBE
 * 마이그 본문을 단일 TX 내 적용 → director 적재 + admin/manager 보존 검증 → ROLLBACK (prod 영구변경 0).
 */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let PW = process.env.SUPABASE_DB_PASSWORD;
for (const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)PW=m[1].trim();}
const c = new Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:PW,ssl:{rejectUnauthorized:false}});
await c.connect();
const body = fs.readFileSync('supabase/migrations/20260625113000_phrase_template_director_write_rls.sql','utf8')
  .replace(/^\s*BEGIN;\s*$/m,'').replace(/^\s*COMMIT;\s*$/m,'');
const q=`SELECT tablename,policyname,cmd,qual FROM pg_policies WHERE schemaname='public' AND policyname IN ('admin_write_super_phrases','admin_write_phrase_templates','admin_write_document_templates') ORDER BY tablename`;
let pass=0, fail=0;
await c.query('BEGIN');
try {
  const before = await c.query(q);
  for (const r of before.rows) {
    const hasDir = /'director'/.test(r.qual);
    console.log(`BEFORE ${r.tablename}: director=${hasDir} (expect false)`);
    if(!hasDir) pass++; else fail++;
  }
  if (before.rows.length!==3){console.log(`!! BEFORE expected 3 policies, got ${before.rows.length}`);fail++;}
  await c.query(body);
  const after = await c.query(q);
  for (const r of after.rows) {
    const hasDir=/'director'/.test(r.qual);
    const hasAM=/'admin'/.test(r.qual)&&/'manager'/.test(r.qual);
    console.log(`AFTER  ${r.tablename}: admin&manager=${hasAM} director=${hasDir} (expect both true)`);
    if(hasDir&&hasAM) pass++; else fail++;
  }
  if (after.rows.length!==3){console.log(`!! AFTER expected 3 policies, got ${after.rows.length}`);fail++;}
} catch(e){ console.error('PROBE ERROR:', e.message); fail++; }
await c.query('ROLLBACK');
const post = await c.query(q);
const leaked = post.rows.filter(r=>/'director'/.test(r.qual));
console.log(`\nPOST-ROLLBACK director leak = ${leaked.length} (expect 0)`);
if(leaked.length===0) pass++; else fail++;
await c.end();
console.log(`\n=== PROBE ${fail===0?'PASS':'FAIL'} (pass=${pass} fail=${fail}) ===`);
process.exit(fail===0?0:1);
