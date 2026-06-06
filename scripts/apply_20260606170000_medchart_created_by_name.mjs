/**
 * T-20260606-foot-MEDCHART-RECORDER-NAME AC-1
 * medical_charts.created_by_name TEXT 컬럼 추가 (DDL only — backfill 은 별도 SQL 게이트).
 * node-pg 직접 연결. dev-foot DB 직접 실행 정책 준수.
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
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

console.log('🚀 medical_charts.created_by_name 추가 (T-20260606-foot-MEDCHART-RECORDER-NAME AC-1)');

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  await client.query(`
    ALTER TABLE public.medical_charts
      ADD COLUMN IF NOT EXISTS created_by_name TEXT;
  `);
  console.log('✅ created_by_name 컬럼 추가 완료 (IF NOT EXISTS)');

  await client.query(`
    COMMENT ON COLUMN public.medical_charts.created_by_name IS
      'T-20260606-foot-MEDCHART-RECORDER-NAME: 기록 시점 의사 표시명 스냅샷. 신규 저장 시 채움. NULL=레거시/미매칭(폴백 표시).';
  `);
  console.log('✅ 컬럼 코멘트 추가');

  // 검증
  const { rows } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'medical_charts'
      AND column_name = 'created_by_name';
  `);
  if (rows.length === 0) {
    throw new Error('컬럼 검증 실패 — created_by_name 미존재');
  }
  console.log('✅ 검증 완료:', rows[0]);
} catch (err) {
  console.error('❌ 실패:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
