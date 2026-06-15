/** #A 적용 실패 진단 — prod claim_diagnoses DRIFT 조사 + 4테이블 현 상태 재확인 (read-only) */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
for (const line of readFileSync(join(__dirname, '../.env'), 'utf8').split('\n')) {
  const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
}
const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432, database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});
try {
  await client.connect();
  const TABLES = ['insurance_claims', 'claim_items', 'claim_diagnoses', 'edi_submissions'];
  console.log('=== 4 테이블 현 존재상태 (post-failed-apply) ===');
  for (const t of TABLES) {
    const { rows } = await client.query(`SELECT to_regclass($1) AS reg;`, [`public.${t}`]);
    console.log(`  ${rows[0].reg ? '✅' : '❌'} ${t}`);
  }
  console.log('\n=== prod claim_diagnoses 실제 컬럼 (DRIFT 원인) ===');
  const { rows: cols } = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='claim_diagnoses' ORDER BY ordinal_position;`);
  cols.forEach(c => console.log(`  ${c.column_name} ${c.data_type} ${c.is_nullable==='NO'?'NOT NULL':''} ${c.column_default||''}`));
  console.log('\n=== claim_diagnoses row count + 의존성 ===');
  const { rows: cnt } = await client.query(`SELECT count(*)::int n FROM public.claim_diagnoses;`);
  console.log(`  rows: ${cnt[0].n}`);
  const { rows: pol } = await client.query(`SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename='claim_diagnoses';`);
  console.log(`  policies: ${pol.map(p=>p.policyname+'('+p.cmd+')').join(', ')||'none'}`);
} catch (e) { console.error('❌', e.message); process.exitCode=1; }
finally { await client.end(); }
