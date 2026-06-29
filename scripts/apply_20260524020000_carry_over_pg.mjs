/**
 * T-20260523-foot-ROOM-DISABLE-TOGGLE AC-3/AC-5
 * daily_room_status.carry_over 컬럼 추가 + 인덱스
 * node-pg 직접 연결 방식
 */
import pg from 'pg';
const { Client } = pg;

// Supabase pooler (transaction mode) — DDL은 session mode로
// host: aws-0-ap-northeast-2.pooler.supabase.com
// port: 5432 (transaction) 또는 6543 (session)
// user: postgres.rxlomoozakkjesdqjtvd
// password: $SUPABASE_DB_PASSWORD (env 주입)
// Note: @ 퍼센트 인코딩 불필요 — 객체 방식 연결

const client = new Client({
  host: 'aws-0-ap-northeast-2.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: (process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })()),
  ssl: { rejectUnauthorized: false },
});

console.log('🚀 carry_over 컬럼 추가 (T-20260523-foot-ROOM-DISABLE-TOGGLE AC-3/AC-5)');

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  await client.query(`
    ALTER TABLE daily_room_status
      ADD COLUMN IF NOT EXISTS carry_over BOOLEAN NOT NULL DEFAULT false;
  `);
  console.log('✅ carry_over 컬럼 추가 완료');

  await client.query(`
    COMMENT ON COLUMN daily_room_status.carry_over IS
      'T-20260523-foot-ROOM-DISABLE-TOGGLE AC-3: false=당일 한정, true=활성화 전까지 유지';
  `);
  console.log('✅ 컬럼 코멘트 추가');

  await client.query(`
    CREATE INDEX IF NOT EXISTS daily_room_status_carry_over_idx
      ON daily_room_status (clinic_id, carry_over, is_active)
      WHERE carry_over = true;
  `);
  console.log('✅ 인덱스 생성 완료');

  // 검증
  const { rows } = await client.query(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'daily_room_status'
      AND column_name = 'carry_over';
  `);
  if (rows.length === 0) {
    throw new Error('컬럼 검증 실패 — carry_over 미존재');
  }
  console.log('✅ 검증 완료:', rows[0]);

} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
