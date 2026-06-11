/**
 * T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL — DRY-RUN
 * 마이그레이션을 트랜잭션 안에서 적용 → 결과 정책 검증 → ROLLBACK (영속 변경 없음).
 * 구문/헬퍼 존재/결과 술어/회귀가드(SELECT 정책 불변)를 확인만 한다.
 * 실제 prod 적용은 supervisor DB 게이트.
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

const migPath = 'supabase/migrations/20260611190000_clinic_events_write_rls_canonical.sql';
let sql = fs.readFileSync(migPath, 'utf8')
  .split('\n').filter(l => !/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n');

const qPol = `SELECT policyname, cmd, qual, with_check FROM pg_policies
   WHERE schemaname='public' AND tablename='clinic_events' ORDER BY cmd, policyname`;

const before = await client.query(qPol);
console.log('── BEFORE 정책 ──');
for (const r of before.rows) {
  console.log(`  clinic_events.${r.policyname} [${r.cmd}]`);
  if (r.cmd === 'SELECT' || r.cmd === 'UPDATE' || r.cmd === 'DELETE') console.log(`      USING: ${(r.qual||'').replace(/\s+/g,' ')}`);
  if (r.cmd === 'INSERT' || r.cmd === 'UPDATE') console.log(`      WITH CHECK: ${(r.with_check||'').replace(/\s+/g,' ')}`);
}

let pass = true;
try {
  await client.query('BEGIN');
  // 헬퍼 존재 확인
  const helpers = await client.query(
    `SELECT proname FROM pg_proc WHERE proname IN ('is_approved_user','current_user_clinic_id')`);
  const hNames = helpers.rows.map(r => r.proname);
  const okHelpers = ['is_approved_user','current_user_clinic_id'].every(h => hNames.includes(h));
  console.log(`\n── 헬퍼 존재: ${okHelpers ? '✅' : '❌'}  (${hNames.join(', ')})`);

  await client.query(sql);
  const after = await client.query(qPol);
  console.log('\n── AFTER 정책 (트랜잭션 내, 미커밋) ──');
  for (const r of after.rows) {
    console.log(`  clinic_events.${r.policyname} [${r.cmd}]`);
    if (r.cmd === 'SELECT' || r.cmd === 'UPDATE' || r.cmd === 'DELETE') console.log(`      USING: ${(r.qual||'').replace(/\s+/g,' ')}`);
    if (r.cmd === 'INSERT' || r.cmd === 'UPDATE') console.log(`      WITH CHECK: ${(r.with_check||'').replace(/\s+/g,' ')}`);
  }

  const writePols = after.rows.filter(r => r.cmd !== 'SELECT');
  // AC-1/AC-2: 쓰기 3정책 canonical 술어
  const isCanon = (s) => /is_approved_user\(\)/.test(s||'') && /current_user_clinic_id\(\)/.test(s||'');
  const noStaff = (s) => !/FROM staff/.test(s||'');
  const ins = after.rows.find(r => r.cmd === 'INSERT');
  const upd = after.rows.find(r => r.cmd === 'UPDATE');
  const del = after.rows.find(r => r.cmd === 'DELETE');
  const okInsert = ins && isCanon(ins.with_check) && noStaff(ins.with_check);
  const okUpdate = upd && isCanon(upd.qual) && isCanon(upd.with_check) && noStaff(upd.qual) && noStaff(upd.with_check); // AC-3: WITH CHECK 존재
  const okDelete = del && isCanon(del.qual) && noStaff(del.qual);
  // AC-4: SELECT 정책 불변 (before/after 동일)
  const selBefore = before.rows.find(r => r.cmd === 'SELECT');
  const selAfter  = after.rows.find(r => r.cmd === 'SELECT');
  const okSelectUnchanged = selBefore && selAfter &&
    (selBefore.qual||'') === (selAfter.qual||'') && (selBefore.with_check||'') === (selAfter.with_check||'');
  // AC-5: blanket-open 미발생
  const okNoBlanket = writePols.every(r => !/^\s*true\s*$/i.test((r.qual||'').trim()) && !/^\s*true\s*$/i.test((r.with_check||'').trim()));

  console.log('\n── 회귀가드 ──');
  const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };
  chk('헬퍼 존재(is_approved_user, current_user_clinic_id)', okHelpers);
  chk('AC-1/2 INSERT canonical + no staff', okInsert);
  chk('AC-1/2/3 UPDATE canonical USING+WITH CHECK + no staff', okUpdate);
  chk('AC-1/2 DELETE canonical + no staff', okDelete);
  chk('AC-4 SELECT 정책 불변(G2 canonical 보존)', okSelectUnchanged);
  chk('AC-5 blanket-open(true) 미발생', okNoBlanket);
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
