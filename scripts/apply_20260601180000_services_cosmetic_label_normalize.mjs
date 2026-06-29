/**
 * T-20260601-foot-SVC-COSMETIC-LABEL-BACKFILL
 * '풋 화장품'(공백) → '풋화장품'(무공백) category_label/category 정규화
 * node-pg 직접 연결. dry-run 후 트랜잭션 내 UPDATE + 검증.
 *
 * 사용: node scripts/apply_20260601180000_services_cosmetic_label_normalize.mjs [--commit]
 *   --commit 없으면 dry-run(ROLLBACK), 있으면 COMMIT.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const { Client } = pg;

const DO_COMMIT = process.argv.includes('--commit');
const SQL = readFileSync(
  new URL('../supabase/migrations/20260601180000_services_cosmetic_label_normalize.sql', import.meta.url),
  'utf8',
);

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432, database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd', password: (process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })()), ssl: { rejectUnauthorized: false },
});

console.log(`🚀 cosmetic_label_normalize (${DO_COMMIT ? 'COMMIT' : 'DRY-RUN'})`);
try {
  await client.connect();
  console.log('✅ DB 연결');
  await client.query('BEGIN');

  const before = await client.query(`SELECT count(*)::int c FROM services WHERE category_label='풋 화장품'`);
  console.log(`  before: '풋 화장품'(공백) row = ${before.rows[0].c}`);

  const res = await client.query(SQL);
  console.log(`  UPDATE 영향 row = ${res.rowCount}`);

  // 검증: 정규화 후 분포
  const dist = await client.query(`
    SELECT category_label, count(*)::int cnt, count(*) FILTER (WHERE active)::int active_cnt
    FROM services WHERE category_label LIKE '%화장품%' GROUP BY category_label ORDER BY category_label`);
  console.table(dist.rows);

  const leftover = await client.query(`SELECT count(*)::int c FROM services WHERE category_label='풋 화장품'`);
  console.log(`  after: '풋 화장품'(공백) 잔여 = ${leftover.rows[0].c} (기대 0)`);

  if (DO_COMMIT) {
    await client.query('COMMIT');
    console.log('✅ COMMIT 완료');
  } else {
    await client.query('ROLLBACK');
    console.log('↩️  DRY-RUN ROLLBACK (실제 반영 안 됨). --commit 으로 실제 적용.');
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('❌ 실패:', e.message); process.exit(1);
} finally {
  await client.end();
}
