/**
 * T-20260603-foot-STATUSFLAG-BROWN
 * check_ins_status_flag_valid CHECK constraint 에 'brown'(후상담) 추가.
 * additive — 기존 데이터 무영향. constraint 갱신 후 'brown' 저장 가능.
 * node-pg 직접 연결 방식
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

// .env 로드 (SUPABASE_DB_PASSWORD)
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) {
  console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)');
  process.exit(1);
}

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

console.log('🚀 status_flag brown 추가 (T-20260603-foot-STATUSFLAG-BROWN)');

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  // 사전 점검: 현재 brown 사용 row 수 (있어선 안 됨)
  const pre = await client.query(`SELECT count(*)::int AS n FROM check_ins WHERE status_flag = 'brown';`);
  console.log(`ℹ️  적용 전 status_flag='brown' row 수: ${pre.rows[0].n}`);

  await client.query(`ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_status_flag_valid;`);
  console.log('✅ 기존 constraint drop');

  await client.query(`
    ALTER TABLE check_ins
      ADD CONSTRAINT check_ins_status_flag_valid CHECK (
        status_flag IS NULL OR status_flag IN (
          'white', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'dark_gray'
        )
      );
  `);
  console.log('✅ constraint 재생성 (brown 포함)');

  await client.query(`
    COMMENT ON COLUMN check_ins.status_flag IS
      '상태 플래그 (카드 배경색): white=정상/red=취소부도/orange=CP데스크/yellow=HL/green=선체험/blue=CP치료실/purple=진료필요/pink=진료완료/brown=후상담/dark_gray=수납완료';
  `);
  console.log('✅ COMMENT 갱신');

  // 검증: brown 저장 dry-run (트랜잭션 롤백)
  await client.query('BEGIN');
  try {
    const ci = await client.query(`SELECT id FROM check_ins LIMIT 1;`);
    if (ci.rows.length) {
      await client.query(`UPDATE check_ins SET status_flag = 'brown' WHERE id = $1;`, [ci.rows[0].id]);
      console.log('✅ dry-run: brown 저장 OK (롤백 예정)');
    } else {
      console.log('ℹ️  dry-run skip: check_ins 비어있음');
    }
  } finally {
    await client.query('ROLLBACK');
    console.log('↩️  dry-run 롤백 완료 (실데이터 무변경)');
  }

} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
