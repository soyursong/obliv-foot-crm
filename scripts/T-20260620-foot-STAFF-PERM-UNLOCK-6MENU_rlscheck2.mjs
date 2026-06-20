/** ③④ write 타깃 RLS 보강 점검 (read-only) */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const c = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await c.connect();
const tables = ['clinics','user_profiles','clinic_settings','message_settings','notification_settings','self_checkin_settings','clinic_messaging'];
const pol = await c.query(`
  SELECT tablename, policyname, cmd, qual, with_check
  FROM pg_policies WHERE schemaname='public' AND tablename = ANY($1) AND cmd <> 'SELECT'
  ORDER BY tablename, cmd, policyname`, [tables]);
for (const r of pol.rows) {
  console.log(`[${r.tablename}] ${r.policyname} (${r.cmd})  USING:${(r.qual||'-').replace(/\s+/g,' ').slice(0,120)} | CHECK:${(r.with_check||'-').replace(/\s+/g,' ').slice(0,120)}`);
}
// 실제 존재하는 messaging 관련 테이블 탐색
const t2 = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%messag%' OR table_name ILIKE '%solapi%' OR table_name ILIKE '%checkin%' OR table_name ILIKE '%clinic%') ORDER BY table_name`);
console.log('\n관련 테이블:', t2.rows.map(r=>r.table_name).join(', '));
// 활성 role 분포
const roles = await c.query(`SELECT role, count(*) FROM user_profiles WHERE active=true GROUP BY role ORDER BY role`);
console.log('\n활성 role 분포:', JSON.stringify(roles.rows));
await c.end();
