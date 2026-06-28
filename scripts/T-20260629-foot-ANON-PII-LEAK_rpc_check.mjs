import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let P=process.env.SUPABASE_DB_PASSWORD;
if(!P&&fs.existsSync('.env'))for(const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const c=new Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
await c.connect();
const r=await c.query(`SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
  (SELECT string_agg(prosecdef::text,'') ) AS sd
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'fn_selfcheckin%' GROUP BY p.proname, p.oid ORDER BY p.proname`);
console.log('=== fn_selfcheckin* RPCs in prod ===');
for(const x of r.rows) console.log(`  ${x.proname}(${x.args})  anon_exec=${x.anon_exec}`);
await c.end();
