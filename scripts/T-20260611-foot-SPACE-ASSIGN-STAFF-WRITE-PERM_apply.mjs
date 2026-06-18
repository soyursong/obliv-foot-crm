/**
 * T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM — APPLY (영속)
 * supervisor FIX-REQUEST MSG-20260618-183721-yrgz: QA/테스트 Supabase 에 migration 미적용
 *   → can_assign_rooms()/room_assignments_assign_* 정책 부재로 E2E phase2 spec_fail.
 * dev-foot 직접 DB 적용 (pg 직접 연결). 마이그 파일(BEGIN/COMMIT 내장) 실행 후 별도 연결로 영속 검증.
 * 실패 시 rollback 마이그(20260611220000_..._scoped.rollback.sql)로 복구.
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
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const migPath = 'supabase/migrations/20260611220000_room_assignments_staff_write_scoped.sql';
const sql = fs.readFileSync(migPath, 'utf8');

const qPol = `SELECT policyname, cmd, qual, with_check FROM pg_policies
   WHERE schemaname='public' AND tablename='room_assignments' ORDER BY cmd, policyname`;

// ── 1) APPLY ──
const c1 = conn();
await c1.connect();
console.log(`✅ DB 연결 (APPLY)  ${new Date().toISOString()}\n`);
try {
  await c1.query(sql); // 파일 내 BEGIN..COMMIT
  console.log('✅ 마이그 실행 완료 (COMMIT).');
} catch (e) {
  console.error('❌ APPLY 실패:', e.message);
  await c1.end();
  process.exit(1);
}
await c1.end();

// ── 2) 별도 연결로 영속 검증 ──
const c2 = conn();
await c2.connect();

// 헬퍼 + RPC 가드
const fn = await c2.query(`
  SELECT proname, prosrc, prosecdef FROM pg_proc
  WHERE proname IN ('can_assign_rooms','save_room_assignments')
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')`);
const can = fn.rows.find(r => r.proname === 'can_assign_rooms');
const rpc = fn.rows.find(r => r.proname === 'save_room_assignments');

const after = await c2.query(qPol);
console.log('\n── 적용 후 room_assignments pg_policies (영속 확인) ──');
for (const r of after.rows) {
  console.log(`  ${r.policyname} [${r.cmd}]`);
}

let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };
console.log('\n── 영속 회귀가드 (E2E spec 동기) ──');
const canSrc = (can?.prosrc || '').replace(/\s+/g, ' ');
const rpcSrc = (rpc?.prosrc || '').replace(/\s+/g, ' ');
chk('AC-2 can_assign_rooms 헬퍼 존재 + SECURITY DEFINER', !!can && can.prosecdef);
chk('AC-2 can_assign_rooms 운영 role(consultant/coordinator/therapist) 포함, tm 제외',
  /'consultant'/.test(canSrc) && /'coordinator'/.test(canSrc) && /'therapist'/.test(canSrc) && !/'tm'/.test(canSrc));
chk('S1/S2 RPC 가드 can_assign_rooms 교체 + is_admin_or_manager 가드 제거',
  !!rpc && rpcSrc.includes('can_assign_rooms()') && !rpcSrc.includes('IF NOT is_admin_or_manager()'));
chk('S5 RPC 원자 DELETE+INSERT(RECUR5) 본문 보존',
  /DELETE FROM room_assignments/i.test(rpcSrc) && /INSERT INTO room_assignments/i.test(rpcSrc));
const ins = after.rows.find(r => r.policyname === 'room_assignments_assign_insert');
const upd = after.rows.find(r => r.policyname === 'room_assignments_assign_update');
chk('S1/S2 assign_insert(INSERT) 정책 존재 + can_assign_rooms', ins && ins.cmd === 'INSERT' && /can_assign_rooms\(\)/.test(ins.with_check || ''));
chk('S1/S2 assign_update(UPDATE) 정책 존재 + can_assign_rooms', upd && upd.cmd === 'UPDATE' && /can_assign_rooms\(\)/.test(upd.qual || ''));
chk('S4 assign_insert/update clinic 스코프 강제',
  ins && /current_user_clinic_id\(\)/.test(ins.with_check || '') && upd && /current_user_clinic_id\(\)/.test(upd.qual || ''));
const del = after.rows.filter(r => r.cmd === 'DELETE');
chk('AC-5 직원 DELETE 정책 미부여 (DELETE 전용 정책 0건)', del.length === 0);
// AC-7 회귀 0
const admin = after.rows.find(r => r.policyname === 'room_assignments_admin_all');
const read = after.rows.find(r => r.policyname === 'room_assignments_approved_read');
const floor = after.rows.find(r => r.policyname === 'room_assignments_staff_update');
chk('AC-7 admin_all / approved_read / staff_update(is_floor_staff) 보존',
  !!admin && /is_admin_or_manager\(\)/.test(admin.qual || '') &&
  !!read && /is_approved_user\(\)/.test(read.qual || '') &&
  !!floor && /is_floor_staff\(\)/.test(floor.qual || ''));
await c2.end();

console.log(`\n${pass ? '✅ APPLY + 영속검증 PASS' : '❌ 영속검증 FAIL'}`);
process.exit(pass ? 0 : 1);
