/**
 * T-20260610-foot-DXBUNDLE-SAVE-FAIL — AC-1 확정 판정 (READ-ONLY, 직접 pg)
 * PostgREST 스키마캐시(PGRST205)는 false-negative 가능 → information_schema/to_regclass 로 확정.
 * SELECT only. prod write 절대 금지.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log(`✅ DB 연결 (READ-ONLY)  ${new Date().toISOString()}\n`);

for (const t of ['diagnosis_sets', 'diagnosis_set_items']) {
  const reg = await client.query(`SELECT to_regclass($1) AS oid`, [`public.${t}`]);
  const info = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [t]);
  const exists = reg.rows[0].oid !== null;
  console.log(`[${t}]`);
  console.log(`  to_regclass         : ${reg.rows[0].oid ?? 'NULL'}`);
  console.log(`  information_schema  : ${info.rowCount > 0 ? 'FOUND' : 'NOT FOUND'}`);
  console.log(`  → 확정: ${exists ? '✅ 존재 O' : '❌ 부재 X'}`);
  if (exists) {
    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t]);
    console.log('  columns:', cols.rows.map(r => `${r.column_name}:${r.data_type}`).join(', '));
    const rls = await client.query(
      `SELECT polname, cmd FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [t])
      .catch(async () => client.query(
        `SELECT policyname AS polname, cmd FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [t]));
    console.log('  RLS policies:', rls.rows.map(r => `${r.polname}(${r.cmd})`).join(', ') || 'NONE');
    const idx = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename=$1`, [t]);
    console.log('  indexes:', idx.rows.map(r => r.indexname).join(', ') || 'NONE');
  }
  console.log('');
}

await client.end();
