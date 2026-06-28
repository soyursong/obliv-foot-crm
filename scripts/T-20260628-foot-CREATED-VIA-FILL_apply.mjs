/**
 * T-20260628-crm-RESV-CREATED-VIA-FILL §2 — APPLY (ADDITIVE)
 * ADD COLUMN created_via text + CHECK(NULL OR IN 9값). 멱등(IF NOT EXISTS / DROP IF EXISTS).
 * DA GO/ADDITIVE 2026-06-28 19:04. 무중단·무 rewrite·write 0(기존행 미변경).
 */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env','utf8').split('\n')) { const m=line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if(m) DB_PASSWORD=m[1].trim(); }
}
const SQL = fs.readFileSync('./supabase/migrations/20260628160000_reservations_created_via.sql','utf8');
const c = new Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:5432, database:'postgres', user:'postgres.rxlomoozakkjesdqjtvd', password:DB_PASSWORD, ssl:{rejectUnauthorized:false}});
await c.connect();
try {
  await c.query(SQL);
  const col = await c.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='created_via'`);
  const chk = await c.query(`SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='public.reservations'::regclass AND conname='reservations_created_via_check'`);
  const dist = await c.query(`SELECT created_via, count(*)::int FROM public.reservations GROUP BY 1 ORDER BY 2 DESC`);
  console.log('✅ APPLIED');
  console.log('COLUMN:', JSON.stringify(col.rows[0]));
  console.log('CHECK :', chk.rows[0]?.def);
  console.log('DIST  :', JSON.stringify(dist.rows));
} catch (e) { console.error('❌ APPLY FAIL:', e.message); process.exitCode=1; }
finally { await c.end(); }
