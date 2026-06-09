/**
 * T-20260609-foot-DOCCALL-DOCTOR-ACK — check_ins.doctor_ack_at 컬럼 신설 적용/검증
 *
 *   AC5) additive only · timestamptz NULL DEFAULT NULL → 기존 row/제약/RLS 영향 0, 무중단.
 *
 * 실행 모드:
 *   node scripts/apply_20260609233000_checkin_doctor_ack_at.mjs --dry-run
 *     → BEGIN; (마이그 SQL); ROLLBACK;  : 파싱·컬럼 생성 검증만, 영속 변경 0.
 *   node scripts/apply_20260609233000_checkin_doctor_ack_at.mjs --apply
 *     → COMMIT. ⚠️ supervisor 마이그 게이트(db_change=true) GO 후에만 사용.
 *
 * node-pg pooler 직접 연결. ADD COLUMN IF NOT EXISTS = 멱등(재실행 안전).
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

const MIG = 'supabase/migrations/20260609233000_checkin_doctor_ack_at.sql';
const inner = fs.readFileSync(MIG, 'utf8')
  .replace(/^\s*BEGIN;\s*$/m, '')
  .replace(/^\s*COMMIT;\s*$/m, '');

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

// 컬럼 존재 + 정의(타입/nullable/default) 검증.
const VERIFY = `
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name='check_ins' AND column_name='doctor_ack_at';
`;

(async () => {
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(inner);
    const r = await client.query(VERIFY);
    console.log('검증 결과(컬럼 정의):', r.rows[0] ?? '(없음)');
    if (r.rows.length !== 1) throw new Error('AC5 위반: check_ins.doctor_ack_at 컬럼 부재');
    if (r.rows[0].data_type !== 'timestamp with time zone') throw new Error('AC5 위반: 타입 불일치 (timestamptz 아님)');
    if (r.rows[0].is_nullable !== 'YES') throw new Error('AC5 위반: NULL 허용 아님');
    if (MODE === 'apply') {
      await client.query('COMMIT');
      console.log('✅ --apply: 마이그 COMMIT 완료. check_ins.doctor_ack_at 생성됨.');
    } else {
      await client.query('ROLLBACK');
      console.log('✅ --dry-run: 컬럼 생성·정의 검증 통과. ROLLBACK (영속 변경 없음).');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ 실패:', e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
