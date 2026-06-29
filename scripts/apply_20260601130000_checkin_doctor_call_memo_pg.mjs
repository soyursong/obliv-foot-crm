/**
 * T-20260601-foot-DOCTOR-CALL-LIST
 * check_ins.doctor_call_memo TEXT NULL 컬럼 추가 (진료콜 명단 진료 전달사항 전용)
 * node-pg 직접 연결 방식
 */
import pg from 'pg';
const { Client } = pg;

// 2026-06-01: 프로젝트 pooler 리전 = ap-southeast-1 (aws-1). 기존 ap-northeast-2 → ENOTFOUND/tenant not found.
const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: (process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })()),
  ssl: { rejectUnauthorized: false },
});

console.log('🚀 check_ins.doctor_call_memo 컬럼 추가 (T-20260601-foot-DOCTOR-CALL-LIST)');

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  await client.query(`
    ALTER TABLE check_ins
      ADD COLUMN IF NOT EXISTS doctor_call_memo TEXT NULL;
  `);
  console.log('✅ doctor_call_memo 컬럼 추가');

  await client.query(`
    COMMENT ON COLUMN check_ins.doctor_call_memo IS
      '원장님 진료콜 명단 진료 전달사항 메모 (진료 전달 전용) — T-20260601-foot-DOCTOR-CALL-LIST';
  `);
  console.log('✅ COMMENT 설정');

  // 검증
  const { rows } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'check_ins' AND column_name = 'doctor_call_memo';
  `);
  console.log('🔎 검증:', JSON.stringify(rows));
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
