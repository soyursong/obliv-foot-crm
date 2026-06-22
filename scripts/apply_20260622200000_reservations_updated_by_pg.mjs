/**
 * T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI — reservations.updated_by ADDITIVE 컬럼 적용
 *
 * ADDITIVE: ADD COLUMN IF NOT EXISTS updated_by TEXT (nullable). 기존 데이터/컬럼/제약 무손실.
 * data-architect CONSULT-REPLY MSG-20260622-215701-p402 = GO. created_by INVARIANT 유지.
 *
 * 실행:
 *   node scripts/apply_20260622200000_reservations_updated_by_pg.mjs --check     # 컬럼 존재 여부만
 *   node scripts/apply_20260622200000_reservations_updated_by_pg.mjs --apply
 *
 * node-pg pooler 직접 연결. 멱등(ADD COLUMN IF NOT EXISTS).
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const MODE = process.argv.includes('--apply') ? 'apply'
           : process.argv.includes('--check') ? 'check'
           : null;
if (!MODE) { console.error('❌ --check 또는 --apply 필요'); process.exit(1); }

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

const COLCHECK = `
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='reservations' AND column_name='updated_by';
`;

const MIGRATION_SQL = fs.readFileSync('supabase/migrations/20260622200000_reservations_updated_by.sql', 'utf8');

(async () => {
  await client.connect();
  try {
    const before = await client.query(COLCHECK);
    console.log('적용 전 updated_by:', before.rows.length ? before.rows[0] : '(없음)');

    if (MODE === 'check') { return; }

    if (before.rows.length > 0) {
      console.log('✅ 이미 존재 — 멱등(ADD COLUMN IF NOT EXISTS), 변경 없음.');
      return;
    }

    console.log('▶ MIGRATION 적용...');
    await client.query(MIGRATION_SQL);
    const after = await client.query(COLCHECK);
    console.log('적용 후 updated_by:', after.rows.length ? after.rows[0] : '(여전히 없음 — 실패)');
    if (after.rows.length === 0) process.exit(2);
    console.log('✅ 적용 완료.');
  } finally {
    await client.end();
  }
})().catch((e) => { console.error('❌ 오류:', e.message); process.exit(1); });
