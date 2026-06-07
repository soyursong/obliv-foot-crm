/**
 * T-20260608-foot-PKG-REBORN-ITEM — packages 테이블에 Re:Born 회차·단가 컬럼 추가
 *
 *   ALTER TABLE packages ADD COLUMN IF NOT EXISTS reborn_sessions   INTEGER DEFAULT 0;
 *   ALTER TABLE packages ADD COLUMN IF NOT EXISTS reborn_unit_price INTEGER DEFAULT 0;
 *
 * additive · backward-compatible (DEFAULT 0 → 기존 row·정렬·집계 무영향). 멱등(재실행 안전).
 * supabase/migrations/20260608120000_foot_pkg_reborn_item.sql 와 동일.
 *
 * 실행 모드:
 *   node scripts/apply_20260608120000_pkg_reborn_item.mjs --dry-run   # 컬럼 존재 여부 SELECT only
 *   node scripts/apply_20260608120000_pkg_reborn_item.mjs --apply      # ADD COLUMN 적용
 *
 * 롤백: supabase/migrations/20260608120000_foot_pkg_reborn_item.rollback.sql
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

const COL_CHECK = `
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name='packages' AND column_name IN ('reborn_sessions','reborn_unit_price')
ORDER BY column_name;`;

try {
  await client.connect();
  console.log(`✅ DB 연결 (mode=${MODE})  ${new Date().toISOString()}`);

  console.log('\n── BEFORE: reborn 컬럼 존재 여부 ──');
  const before = await client.query(COL_CHECK);
  console.table(before.rows);
  console.log(`▶ 존재 컬럼 수 = ${before.rowCount} / 2`);

  if (MODE === 'dry-run') {
    console.log('\n🟡 dry-run 종료 (변경 없음).');
    await client.end();
    process.exit(0);
  }

  console.log('\n── APPLY: ADD COLUMN (additive DEFAULT 0) ──');
  await client.query('BEGIN');
  await client.query(`ALTER TABLE packages ADD COLUMN IF NOT EXISTS reborn_sessions   INTEGER DEFAULT 0;`);
  await client.query(`ALTER TABLE packages ADD COLUMN IF NOT EXISTS reborn_unit_price INTEGER DEFAULT 0;`);
  await client.query(`COMMENT ON COLUMN packages.reborn_sessions   IS 'Re:Born 회차 (T-20260608-foot-PKG-REBORN-ITEM)';`);
  await client.query(`COMMENT ON COLUMN packages.reborn_unit_price IS 'Re:Born 회당 수가 (T-20260608-foot-PKG-REBORN-ITEM)';`);
  await client.query('COMMIT');
  console.log('✅ COMMIT 완료');

  console.log('\n── AFTER: reborn 컬럼 검증 ──');
  const after = await client.query(COL_CHECK);
  console.table(after.rows);
  console.log(`▶ 존재 컬럼 수 = ${after.rowCount} / 2  (기대: 2)`);

  // 기존 row 무영향 확인 (DEFAULT 0 채워짐)
  const sample = await client.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE reborn_sessions=0) AS zero_sessions FROM packages;`);
  console.log('▶ 기존 packages row (reborn_sessions=0 기본값 확인):', sample.rows[0]);

  await client.end();
  console.log('\n🟢 done.');
} catch (e) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error('❌ 실패:', e.message);
  await client.end().catch(() => {});
  process.exit(1);
}
