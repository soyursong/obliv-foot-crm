/**
 * T-20260602-foot-SELFCHECKIN-RESV-LINK — self_checkin_with_reservation_link RPC 적용
 *
 * 성격: additive·reversible. CREATE OR REPLACE FUNCTION 1개 + GRANT.
 *   테이블 DDL/데이터 변경 없음. 롤백 = DROP FUNCTION(데이터 무손실).
 *   FE 는 RPC 미배포 시 레거시 분산 경로로 graceful fallback → 적용 자체는 무중단·무회귀.
 *
 * 적용: node scripts/apply_20260602210000_selfcheckin_with_reservation_link_rpc.mjs
 * 롤백: supabase/migrations/20260602210000_selfcheckin_with_reservation_link_rpc.rollback.sql
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dirname, '../supabase/migrations/20260602210000_selfcheckin_with_reservation_link_rpc.sql'),
  'utf8',
);

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: 'bQpgC6tYfXhp@Hr',
  ssl: { rejectUnauthorized: false },
});

console.log('🚀 self_checkin_with_reservation_link RPC 적용');
try {
  await client.connect();
  await client.query(SQL);

  // 검증: 함수 존재 + SECURITY DEFINER + anon EXECUTE 권한
  const { rows } = await client.query(`
    SELECT p.proname,
           p.prosecdef AS security_definer,
           pg_get_function_identity_arguments(p.oid) AS args,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'self_checkin_with_reservation_link';
  `);
  console.log('🔎 검증:', JSON.stringify(rows));
  if (rows.length !== 1) throw new Error('함수가 생성되지 않음 — 검증 실패');
  if (!rows[0].security_definer) throw new Error('SECURITY DEFINER 아님 — AC-5 위반');
  if (!rows[0].anon_execute) throw new Error('anon EXECUTE 권한 없음 — 키오스크 호출 불가');
  console.log('✅ self_checkin_with_reservation_link 생성 + SECURITY DEFINER + anon EXECUTE 확인');
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
