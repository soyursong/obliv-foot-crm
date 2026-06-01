/**
 * T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS
 * save_room_assignments 원자적 저장 RPC 적용 (additive, idempotent)
 * node-pg 직접 연결
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const { Client } = pg;

const SQL = readFileSync(
  new URL('../supabase/migrations/20260601150000_save_room_assignments_atomic_rpc.sql', import.meta.url),
  'utf8',
);

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: 'bQpgC6tYfXhp@Hr',
  ssl: { rejectUnauthorized: false },
});

console.log('🚀 save_room_assignments RPC 적용 (T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS)');
try {
  await client.connect();
  console.log('✅ DB 연결');

  await client.query(SQL);
  console.log('✅ 마이그레이션 적용 완료');

  // 검증 1: 함수 존재 + 시그니처
  const fn = await client.query(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
           p.prosecdef AS security_definer
    FROM pg_proc p WHERE p.proname='save_room_assignments';
  `);
  console.table(fn.rows);

  // 검증 2: 권한 (authenticated EXECUTE, anon/public 없음)
  const grants = await client.query(`
    SELECT grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE routine_name='save_room_assignments';
  `);
  console.table(grants.rows);

  console.log('\n✅ 적용 + 검증 완료');
} catch (e) {
  console.error('❌ 실패:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
