/**
 * T-20260622-foot-CONSULT-ASSIGN-BALANCE — 상담사 자동배정 쏠림 버그픽스
 *   assign_consultant_atomic 부하 카운트: 진행중-only → 당일 누적(취소 제외)
 *
 * 적용:  node scripts/apply_20260622170000_foot_assign_consultant_daily_cumulative.mjs
 * 롤백:  node scripts/apply_20260622170000_foot_assign_consultant_daily_cumulative.mjs --rollback
 *
 * 트랜잭션 안전(본문 BEGIN/COMMIT + DO 블록 ASSERT). 멱등 CREATE OR REPLACE.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROLLBACK = process.argv.includes('--rollback');
const FILE = ROLLBACK
  ? '20260622170000_foot_assign_consultant_daily_cumulative.rollback.sql'
  : '20260622170000_foot_assign_consultant_daily_cumulative.sql';
const SQL = readFileSync(join(__dirname, '../supabase/migrations/', FILE), 'utf8');

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })(),
  ssl: { rejectUnauthorized: false },
});

console.log(`🚀 CONSULT-ASSIGN-BALANCE ${ROLLBACK ? '롤백' : '적용'} (${FILE})`);
try {
  await client.connect();
  await client.query(SQL);

  const { rows } = await client.query(
    `SELECT pg_get_functiondef('assign_consultant_atomic(uuid,text,int)'::regprocedure) AS def`,
  );
  const def = rows[0].def;
  const hasNew = def.includes("ci.status <> 'cancelled'");
  const hasOld = def.includes("'consult_waiting', 'consultation'");
  const hasKst = def.includes('kst_date(ci.checked_in_at)');
  const ok = ROLLBACK ? (hasOld && !hasNew && hasKst) : (hasNew && !hasOld && hasKst);
  console.log(`  new(<>cancelled)=${hasNew}  old(IN)=${hasOld}  kst=${hasKst}`);
  console.log(`  ${ok ? '✅' : '❌'} ${ROLLBACK ? '롤백' : '적용'} 검증 ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) throw new Error('검증 실패');
  console.log(`✅ CONSULT-ASSIGN-BALANCE ${ROLLBACK ? '롤백' : '적용'} 완료`);
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
