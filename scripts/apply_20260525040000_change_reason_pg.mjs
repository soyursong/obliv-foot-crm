/**
 * T-20260525-foot-RESV-CHANGE-REASON
 * reservation_logs.change_reason TEXT NULL 컬럼 추가
 * node-pg 직접 연결 방식
 */
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'aws-0-ap-northeast-2.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: (process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })()),
  ssl: { rejectUnauthorized: false },
});

console.log('🚀 reservation_logs.change_reason 컬럼 추가 (T-20260525-foot-RESV-CHANGE-REASON)');

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  await client.query(`
    ALTER TABLE reservation_logs
      ADD COLUMN IF NOT EXISTS change_reason TEXT NULL;
  `);
  console.log('✅ change_reason 컬럼 추가');

  await client.query(`
    COMMENT ON COLUMN reservation_logs.change_reason IS
      '예약 변경 사유 (optional) — T-20260525-foot-RESV-CHANGE-REASON';
  `);
  console.log('✅ COMMENT 설정');

} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
