/**
 * T-20260602-foot-SLOT-DWELL-TIME (B안) — fn_check_in_slot_dwell RPC 적용
 *
 * 성격: additive·reversible·read-only. CREATE OR REPLACE FUNCTION 1개 + GRANT authenticated.
 *   기존 테이블 스키마/데이터 변경 없음(status_transitions 전이 인터벌만 SELECT).
 *   롤백 = DROP FUNCTION(데이터 무손실). AC-4 게이트: 운영 적용은 supervisor 승인 후.
 *
 * 적용: node scripts/apply_20260602230000_check_in_slot_dwell_fn.mjs
 * 롤백: supabase/migrations/20260602230000_check_in_slot_dwell_fn.rollback.sql
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dirname, '../supabase/migrations/20260602230000_check_in_slot_dwell_fn.sql'),
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

console.log('🚀 fn_check_in_slot_dwell RPC 적용');
try {
  await client.connect();
  await client.query(SQL);

  // 검증: 함수 존재 + SECURITY INVOKER(prosecdef=false) + authenticated EXECUTE
  const { rows } = await client.query(`
    SELECT p.proname,
           p.prosecdef AS security_definer,
           pg_get_function_identity_arguments(p.oid) AS args,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_check_in_slot_dwell';
  `);
  console.log('🔎 검증:', JSON.stringify(rows));
  if (rows.length !== 1) throw new Error('함수가 생성되지 않음 — 검증 실패');
  if (rows[0].security_definer) throw new Error('SECURITY DEFINER 임 — RLS 우회 위험(AC-4 위반)');
  if (!rows[0].auth_execute) throw new Error('authenticated EXECUTE 권한 없음 — 차트 호출 불가');
  console.log('✅ fn_check_in_slot_dwell 생성 + SECURITY INVOKER + authenticated EXECUTE 확인');
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
