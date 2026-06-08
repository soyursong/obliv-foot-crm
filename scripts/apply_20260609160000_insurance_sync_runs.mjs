/**
 * T-20260609-foot-HIRA-INSURANCE-BATCH Phase2 — insurance_sync_runs 테이블 생성
 *
 *   CREATE TABLE IF NOT EXISTS public.insurance_sync_runs (...);  + index + RLS read(admin/manager)
 *
 * additive · backward-compatible (신규 테이블, 기존 경로 무영향). 멱등(IF NOT EXISTS, 재실행 안전).
 * supabase/migrations/20260609160000_insurance_sync_runs.sql 와 동일.
 *
 * 실행 모드:
 *   node scripts/apply_20260609160000_insurance_sync_runs.mjs --dry-run   # 테이블 존재 여부만 확인
 *   node scripts/apply_20260609160000_insurance_sync_runs.mjs --apply      # 생성
 *
 * 롤백: supabase/migrations/20260609160000_insurance_sync_runs.rollback.sql
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const MODE = process.argv.includes('--apply') ? 'apply'
           : process.argv.includes('--dry-run') ? 'dry-run'
           : null;
if (!MODE) { console.error('❌ --dry-run 또는 --apply 필요'); process.exit(1); }

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

const EXISTS_CHECK = `SELECT to_regclass('public.insurance_sync_runs') AS tbl;`;

try {
  await client.connect();
  console.log(`✅ DB 연결 (mode=${MODE})  ${new Date().toISOString()}`);

  console.log('\n── BEFORE: insurance_sync_runs 테이블 존재 여부 ──');
  const before = await client.query(EXISTS_CHECK);
  console.log('▶ to_regclass =', before.rows[0].tbl);

  if (MODE === 'dry-run') {
    console.log('\n🟡 dry-run 종료 (변경 없음).');
    await client.end();
    process.exit(0);
  }

  console.log('\n── APPLY: CREATE TABLE + index + RLS ──');
  const sql = fs.readFileSync('supabase/migrations/20260609160000_insurance_sync_runs.sql', 'utf8');
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('✅ COMMIT 완료');

  console.log('\n── AFTER: 검증 ──');
  const after = await client.query(EXISTS_CHECK);
  console.log('▶ to_regclass =', after.rows[0].tbl, '(기대: public.insurance_sync_runs)');
  const cols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='insurance_sync_runs' ORDER BY ordinal_position;`);
  console.log('▶ 컬럼:', cols.rows.map((r) => r.column_name).join(', '));

  await client.end();
  console.log('\n🟢 done.');
} catch (e) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error('❌ 실패:', e.message);
  await client.end().catch(() => {});
  process.exit(1);
}
