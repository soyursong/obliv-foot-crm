/**
 * T-20260609-foot-SMS-BRANCHNAME-FIX — clinics SELECT RLS 절단 (READ-ONLY)
 * FE(anon/auth)에서 clinics.name 을 manager 역할이 실제로 읽을 수 있는가?
 * 못 읽으면 → 미리보기 {지점명} 공백/누락 = "다르게 나옴" (EF는 service role 이라 정상)
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432, database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});
async function q(label, sql) {
  try { const r = await client.query(sql); console.log(`\n=== ${label} (${r.rowCount}) ===`); console.table(r.rows); return r.rows; }
  catch (e) { console.log(`\n=== ${label} ERROR: ${e.message} ===`); return []; }
}
await client.connect();
await q('clinics RLS enabled?', `select relname, relrowsecurity from pg_class where relname='clinics'`);
await q('clinics policies', `select polname, polcmd,
  pg_get_expr(polqual, polrelid) as using_expr,
  pg_get_expr(polwithcheck, polrelid) as check_expr
  from pg_policy where polrelid='public.clinics'::regclass`);
await q('clinic_messaging_capability RLS', `select relname, relrowsecurity from pg_class where relname='clinic_messaging_capability'`);
await q('clinic_messaging_capability policies', `select polname, polcmd,
  pg_get_expr(polqual, polrelid) as using_expr from pg_policy where polrelid='public.clinic_messaging_capability'::regclass`);
await client.end();
console.log('\n[done]');
