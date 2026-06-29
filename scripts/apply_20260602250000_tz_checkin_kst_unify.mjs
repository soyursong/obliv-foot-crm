/**
 * T-20260602-foot-TZ-AUDIT-FIX — RPC 일일경계 KST 통일 (4개 함수 CREATE OR REPLACE)
 *
 * 적용:  node scripts/apply_20260602250000_tz_checkin_kst_unify.mjs
 * 롤백:  node scripts/apply_20260602250000_tz_checkin_kst_unify.mjs --rollback
 *
 * 트랜잭션 안전(마이그레이션 본문이 BEGIN/COMMIT 포함, 멱등 CREATE OR REPLACE).
 * 본문 끝 DO 블록이 4개 함수 정의에 kst_date 포함을 ASSERT → 미반영 시 전체 롤백.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROLLBACK = process.argv.includes('--rollback');
const FILE = ROLLBACK
  ? '20260602250000_tz_checkin_kst_unify.rollback.sql'
  : '20260602250000_tz_checkin_kst_unify.sql';
const SQL = readFileSync(join(__dirname, '../supabase/migrations/', FILE), 'utf8');

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })(),
  ssl: { rejectUnauthorized: false },
});

console.log(`🚀 TZ-AUDIT-FIX RPC ${ROLLBACK ? '롤백' : '적용'} (${FILE})`);
try {
  await client.connect();
  await client.query(SQL);

  // 검증: 적용 시 kst_date 포함 / 롤백 시 미포함
  const checks = [
    ['next_queue_number(uuid,date)', 'kst_date(checked_in_at)'],
    ['batch_checkin(uuid,jsonb)', 'kst_date(checked_in_at)'],
    ['assign_consultant_atomic(uuid,text,int)', 'kst_date(ci.checked_in_at)'],
    ['self_checkin_with_reservation_link(uuid,jsonb,date)', 'kst_date(checked_in_at)'],
  ];
  for (const [sig, needle] of checks) {
    const { rows } = await client.query(
      `SELECT position($1 IN pg_get_functiondef($2::regprocedure)) > 0 AS has`,
      [needle, sig],
    );
    const has = rows[0].has;
    const ok = ROLLBACK ? !has : has;
    console.log(`  ${ok ? '✅' : '❌'} ${sig.split('(')[0]} kst_date=${has}`);
    if (!ok) throw new Error(`검증 실패: ${sig}`);
  }
  console.log(`✅ TZ-AUDIT-FIX RPC ${ROLLBACK ? '롤백' : '적용'} 완료`);
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
