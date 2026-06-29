/**
 * T-20260610-foot-RESV-DUPGUARD-SAMEDAY — fn_reservation_dup_guard RPC 적용
 *
 * 안전성: 조회 전용 함수 신설(데이터 무변경). CREATE OR REPLACE → 재적용 idempotent.
 *         FE 는 본 RPC 미배포 시 fallback SELECT 로 강하 → 무중단.
 *
 * ⚠️ 운영 적용은 supervisor 게이트(GO_WARN, 본 티켓 DB 변경 일괄 검토 — AC-0 #4).
 *    dev-foot 은 본 스크립트를 "실행하지 않고" 생성만 한다. supervisor 가 QA 후 직접 실행.
 *    index(20260610100010)는 dedupe(13그룹)+사람확인 완료 후에만 별도 실행.
 *
 * 적용: node scripts/apply_20260610100000_reservation_dup_guard_fn.mjs
 * 롤백: supabase/migrations/20260610100000_reservation_dup_guard_fn.rollback.sql
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dirname, '../supabase/migrations/20260610100000_reservation_dup_guard_fn.sql'),
  'utf8',
);

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: (process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })()),
  ssl: { rejectUnauthorized: false },
});

console.log('🚀 fn_reservation_dup_guard 적용 (T-20260610-foot-RESV-DUPGUARD-SAMEDAY)');
try {
  await client.connect();
  await client.query(SQL);
  const { rows } = await client.query(`
    SELECT proname FROM pg_proc WHERE proname = 'fn_reservation_dup_guard';
  `);
  console.log('🔎 검증:', JSON.stringify(rows));
  if (rows.length < 1) throw new Error('함수가 생성되지 않음 — 검증 실패');
  console.log('✅ fn_reservation_dup_guard 생성 완료');
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
