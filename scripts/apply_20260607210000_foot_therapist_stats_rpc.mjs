/**
 * T-20260607-foot-THERAPIST-STATS
 * 치료사 기준 통계 RPC 2종 + 보강 인덱스 적용.
 * supabase/migrations/20260607210000_foot_therapist_stats_rpc.sql 을 그대로 적용.
 * node-pg 직접 연결. dev-foot DB 직접 실행 정책 준수.
 *
 * 재실행 안전: 함수는 CREATE OR REPLACE, 인덱스는 CREATE INDEX IF NOT EXISTS (완전 멱등).
 * 비파괴: 테이블/컬럼 변경 0. 롤백 = 20260607210000_..._rpc.rollback.sql.
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

console.log('🚀 foot_stats_therapist_summary / foot_stats_therapist_services 적용 (T-20260607-foot-THERAPIST-STATS)');

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  const sql = fs.readFileSync('supabase/migrations/20260607210000_foot_therapist_stats_rpc.sql', 'utf8');

  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('✅ RPC + 인덱스 적용 완료');

  // 검증 1: 함수 존재
  const { rows: fns } = await client.query(`
    SELECT proname FROM pg_proc
    WHERE proname IN ('foot_stats_therapist_summary','foot_stats_therapist_services')
    ORDER BY proname;
  `);
  const found = fns.map(r => r.proname);
  if (!found.includes('foot_stats_therapist_summary') || !found.includes('foot_stats_therapist_services')) {
    throw new Error(`함수 검증 실패 — found=${JSON.stringify(found)}`);
  }
  console.log('✅ 함수:', found.join(', '));

  // 검증 2: 인덱스 존재
  const { rows: idx } = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE indexname = 'idx_status_transitions_checkin_tostatus';
  `);
  console.log('✅ 인덱스:', idx.map(r => r.indexname).join(', ') || '(없음)');

  // 검증 3: 실호출 smoke (임의 clinic + 최근 30일). 에러 없이 반환만 확인.
  const { rows: clinics } = await client.query(`SELECT id FROM clinics LIMIT 1;`);
  if (clinics.length) {
    const cid = clinics[0].id;
    const sm = await client.query(
      `SELECT * FROM foot_stats_therapist_summary($1, (now() - interval '30 days')::date, now()::date);`, [cid]);
    const sv = await client.query(
      `SELECT * FROM foot_stats_therapist_services($1, (now() - interval '30 days')::date, now()::date);`, [cid]);
    console.log(`✅ smoke 호출 OK — summary rows=${sm.rowCount}, services rows=${sv.rowCount}`);
  }
} catch (err) {
  try { await client.query('ROLLBACK'); } catch { /* noop */ }
  console.error('❌ 실패:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
