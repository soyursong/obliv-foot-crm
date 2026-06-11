/**
 * T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM — DRY-RUN
 * 마이그를 트랜잭션 안에서 적용 → 결과 정책/RPC/회귀가드 검증 → ROLLBACK (prod 영속 변경 없음).
 * 실제 prod 적용은 supervisor DB 게이트.
 *
 * 검증:
 *   AC-2  : RPC save_room_assignments 가드 = can_assign_rooms (is_admin_or_manager 아님)
 *   AC-2/4: room_assignments_assign_insert (INSERT) + assign_update (UPDATE) = can_assign_rooms + clinic
 *   AC-3  : 본 마이그가 room_assignments 외 다른 테이블 정책 미접촉
 *   AC-5  : 직원 DELETE 정책 미부여 (DELETE 전용 정책 0건, admin_all ALL 만)
 *   AC-7  : admin_all / approved_read / staff_update(is_floor_staff) 미변경
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
const client = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`✅ DB 연결  ${new Date().toISOString()}  (DRY-RUN — 끝에서 ROLLBACK)\n`);

const migPath = 'supabase/migrations/20260611220000_room_assignments_staff_write_scoped.sql';
const sql = fs.readFileSync(migPath, 'utf8')
  .split('\n').filter(l => !/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n');

const qPol = `SELECT policyname, cmd, qual, with_check FROM pg_policies
   WHERE schemaname='public' AND tablename='room_assignments' ORDER BY cmd, policyname`;
const qRpc = `SELECT prosrc FROM pg_proc WHERE proname='save_room_assignments'`;

const before = await client.query(qPol);
console.log('── BEFORE room_assignments 정책 ──');
for (const r of before.rows) console.log(`  ${r.policyname} [${r.cmd}]`);

let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };
try {
  await client.query('BEGIN');

  // 헬퍼 의존 존재 확인
  const helpers = await client.query(
    `SELECT proname FROM pg_proc WHERE proname IN ('is_approved_user','current_user_clinic_id','current_user_role','is_admin_or_manager')`);
  const hNames = [...new Set(helpers.rows.map(r => r.proname))];
  const okHelpers = ['is_approved_user','current_user_clinic_id','current_user_role','is_admin_or_manager'].every(h => hNames.includes(h));
  console.log(`\n── 의존 헬퍼 존재: ${okHelpers ? '✅' : '❌'}  (${hNames.join(', ')})`);

  await client.query(sql);

  // can_assign_rooms 생성 + tm 제외 확인
  const fn = await client.query(`SELECT prosrc FROM pg_proc WHERE proname='can_assign_rooms'`);
  const fnSrc = (fn.rows[0]?.prosrc || '').replace(/\s+/g, ' ');
  const okHelperCreated = fn.rows.length === 1;
  const okTmExcluded = !/'tm'/.test(fnSrc) && /is_approved_user\(\)/.test(fnSrc) && /'consultant'/.test(fnSrc);

  const after = await client.query(qPol);
  console.log('\n── AFTER room_assignments 정책 (트랜잭션 내, 미커밋) ──');
  for (const r of after.rows) {
    console.log(`  ${r.policyname} [${r.cmd}]`);
    if (['SELECT','UPDATE','DELETE'].includes(r.cmd)) console.log(`      USING: ${(r.qual||'').replace(/\s+/g,' ')}`);
    if (['INSERT','UPDATE'].includes(r.cmd)) console.log(`      WITH CHECK: ${(r.with_check||'').replace(/\s+/g,' ')}`);
  }

  const byName = Object.fromEntries(after.rows.map(r => [r.policyname, r]));
  const isCanon = (s) => /can_assign_rooms\(\)/.test(s||'') && /current_user_clinic_id\(\)/.test(s||'');

  // AC-2/4: 신규 INSERT/UPDATE
  const ins = byName['room_assignments_assign_insert'];
  const upd = byName['room_assignments_assign_update'];
  const okInsert = ins && ins.cmd === 'INSERT' && isCanon(ins.with_check);
  const okUpdate = upd && upd.cmd === 'UPDATE' && isCanon(upd.qual) && isCanon(upd.with_check);

  // AC-2: RPC 가드 교체
  const rpc = await client.query(qRpc);
  const rpcSrc = (rpc.rows[0]?.prosrc || '').replace(/\s+/g, ' ');
  const okRpc = /can_assign_rooms\(\)/.test(rpcSrc) && !/is_admin_or_manager\(\)/.test(rpcSrc)
    && /current_user_clinic_id\(\)/.test(rpcSrc);  // clinic 가드 보존

  // AC-5: 직원 DELETE 정책 미부여 (DELETE 전용 cmd 0건)
  const deletePols = after.rows.filter(r => r.cmd === 'DELETE');
  const okNoDelete = deletePols.length === 0;

  // AC-7: 기존 3정책 미변경 (admin_all / approved_read / staff_update 존재 + 술어 동일)
  const beforeByName = Object.fromEntries(before.rows.map(r => [r.policyname, r]));
  const unchanged = (n) => beforeByName[n] && byName[n]
    && (beforeByName[n].qual||'') === (byName[n].qual||'')
    && (beforeByName[n].with_check||'') === (byName[n].with_check||'');
  const okAdminUnchanged = unchanged('room_assignments_admin_all')
    && unchanged('room_assignments_approved_read')
    && unchanged('room_assignments_staff_update');

  // AC-5 보강: staff_update 가 여전히 is_floor_staff (tm 보존) — UPDATE 만, DELETE 아님
  const okFloorStaffPreserved = /is_floor_staff\(\)/.test(byName['room_assignments_staff_update']?.qual || '');

  // AC-3: 신규 정책이 room_assignments 한정 (이 쿼리는 room_assignments 만 조회 — 타 테이블 변화는
  //       마이그 SQL 텍스트가 room_assignments + 2함수만 ALTER 함으로 정적 보증. 동적 가드:)
  const otherTblTouch = await client.query(
    `SELECT count(*)::int AS n FROM pg_policies
       WHERE schemaname='public' AND policyname IN ('room_assignments_assign_insert','room_assignments_assign_update')
         AND tablename <> 'room_assignments'`);
  const okScoped = otherTblTouch.rows[0].n === 0;

  console.log('\n── 회귀가드 ──');
  chk('의존 헬퍼 존재', okHelpers);
  chk('(A) can_assign_rooms 생성 + tm 제외 + consultant 포함', okHelperCreated && okTmExcluded);
  chk('AC-2 RPC 가드 can_assign_rooms 로 교체(+clinic 보존, is_admin_or_manager 제거)', okRpc);
  chk('AC-2/4 assign_insert = INSERT canonical(can_assign_rooms+clinic)', okInsert);
  chk('AC-2/4 assign_update = UPDATE canonical USING+WITH CHECK(can_assign_rooms+clinic)', okUpdate);
  chk('AC-5 직원 DELETE 정책 미부여(DELETE 전용 0건)', okNoDelete);
  chk('AC-7 admin_all/approved_read/staff_update 술어 미변경', okAdminUnchanged);
  chk('AC-5/7 staff_update 가 is_floor_staff 보존(tm UPDATE 회귀 0)', okFloorStaffPreserved);
  chk('AC-3 신규 정책 room_assignments 한정', okScoped);
} catch (e) {
  pass = false;
  console.error('\n❌ 적용 중 오류:', e.message);
} finally {
  await client.query('ROLLBACK');
  console.log('\n↩️  ROLLBACK 완료 — prod 영속 변경 없음.');
  await client.end();
}
console.log(`\n${pass ? '✅ DRY-RUN PASS' : '❌ DRY-RUN FAIL'}`);
process.exit(pass ? 0 : 1);
