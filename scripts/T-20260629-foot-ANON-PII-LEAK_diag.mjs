/** T-20260629-foot-ANON-PII-LEAK — DIAGNOSTIC (read-only) */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) for (const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)DB_PASSWORD=m[1].trim();}
const conn=()=>new Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:DB_PASSWORD,ssl:{rejectUnauthorized:false}});
const c=conn(); await c.connect();
console.log('연결 OK', new Date().toISOString());
const pol = await c.query(`SELECT tablename, policyname, cmd, roles::text AS roles, qual FROM pg_policies WHERE schemaname='public' AND 'anon'=ANY(roles) ORDER BY tablename, cmd, policyname`);
console.log('\n=== anon 역할 포함 정책 전체 ('+pol.rows.length+'건) ===');
for (const r of pol.rows) console.log(`[${r.cmd}] ${r.tablename}.${r.policyname}  roles=${r.roles}\n     USING: ${(r.qual||'(none)').replace(/\s+/g,' ')}`);
// table-level grants to anon
const gr = await c.query(`SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee='anon' AND table_schema='public' AND table_name IN ('customers','check_ins','reservations','staff','user_profiles','payments') ORDER BY table_name, privilege_type`);
console.log('\n=== anon 테이블 GRANT (민감테이블) ===');
for (const r of gr.rows) console.log(`  ${r.table_name}: ${r.privilege_type}`);
await c.end();
