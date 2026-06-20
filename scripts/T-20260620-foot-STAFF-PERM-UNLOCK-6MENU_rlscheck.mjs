/**
 * T-20260620-foot-STAFF-PERM-UNLOCK-6MENU — 현재 RLS/RPC 게이트 read-only 점검
 * write 경로별 effective RLS + rrn_decrypt 게이트 + RRN audit-log 경로 확인.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const c = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await c.connect();
console.log('✅ DB 연결\n');

const tables = ['daily_closings','closing_manual_payments','customers','packages','package_payments','package_sessions','services','check_in_services'];
const pol = await c.query(`
  SELECT tablename, policyname, cmd, qual, with_check
  FROM pg_policies
  WHERE schemaname='public' AND tablename = ANY($1) AND cmd <> 'SELECT'
  ORDER BY tablename, cmd, policyname`, [tables]);
console.log('=== non-SELECT RLS policies (current effective) ===');
for (const r of pol.rows) {
  console.log(`[${r.tablename}] ${r.policyname} (${r.cmd})`);
  console.log(`    USING: ${r.qual || '-'}`);
  console.log(`    CHECK: ${r.with_check || '-'}`);
}

console.log('\n=== rrn_decrypt 함수 본문(게이트) ===');
const fn = await c.query(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname='rrn_decrypt'`);
console.log(fn.rows[0]?.def || '(없음)');

console.log('\n=== RRN audit-log 흔적 (테이블/RPC) ===');
const audit = await c.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND (table_name ILIKE '%rrn%' OR table_name ILIKE '%audit%' OR table_name ILIKE '%access_log%')
  ORDER BY table_name`);
console.log('audit/rrn 관련 테이블:', audit.rows.map(r => r.table_name));
const rrnProcs = await c.query(`SELECT proname FROM pg_proc WHERE proname ILIKE '%rrn%' ORDER BY proname`);
console.log('rrn 관련 RPC:', rrnProcs.rows.map(r => r.proname));

console.log('\n=== role helper 함수 정의 (게이트 술어) ===');
const helpers = await c.query(`
  SELECT proname, pg_get_functiondef(oid) AS def FROM pg_proc
  WHERE proname IN ('is_admin_or_manager','current_user_is_admin_or_manager','is_floor_staff','is_consultant_or_above','is_coordinator_or_above','is_therapist_or_technician','is_approved_user','current_user_role')
  ORDER BY proname`);
for (const r of helpers.rows) {
  // 본문에서 role 비교 부분만 추출
  const body = r.def.replace(/\s+/g,' ');
  console.log(`• ${r.proname}: ${body.slice(0, 260)}`);
}

await c.end();
console.log('\n=== done ===');
