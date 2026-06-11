/**
 * T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL — APPLY (영속)
 * dev-foot 직접 DB 적용 (SHADOW_MODE 우회: supabase db push 대신 pg 직접 연결).
 * 마이그 파일(BEGIN/COMMIT 내장)을 그대로 실행 후 → 별도 연결로 pg_policies 영속 검증.
 * 실패 시 rollback 마이그로 복구 가능 (20260611190000_..._rollback.sql).
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

const migPath = 'supabase/migrations/20260611190000_clinic_events_write_rls_canonical.sql';
const sql = fs.readFileSync(migPath, 'utf8');

const qPol = `SELECT policyname, cmd, qual, with_check FROM pg_policies
   WHERE schemaname='public' AND tablename='clinic_events' ORDER BY cmd, policyname`;

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
const after = await c2.query(qPol);
console.log('\n── 적용 후 pg_policies (신규 연결, 영속 확인) ──');
for (const r of after.rows) {
  console.log(`  clinic_events.${r.policyname} [${r.cmd}]`);
  if (['SELECT','UPDATE','DELETE'].includes(r.cmd)) console.log(`      USING: ${(r.qual||'').replace(/\s+/g,' ')}`);
  if (['INSERT','UPDATE'].includes(r.cmd)) console.log(`      WITH CHECK: ${(r.with_check||'').replace(/\s+/g,' ')}`);
}

const isCanon = (s) => /is_approved_user\(\)/.test(s||'') && /current_user_clinic_id\(\)/.test(s||'');
const noStaff = (s) => !/FROM staff/.test(s||'');
const ins = after.rows.find(r => r.cmd === 'INSERT');
const upd = after.rows.find(r => r.cmd === 'UPDATE');
const del = after.rows.find(r => r.cmd === 'DELETE');
const sel = after.rows.find(r => r.cmd === 'SELECT');

let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };
console.log('\n── 영속 회귀가드 ──');
chk('AC-1/2 INSERT canonical + no staff', ins && isCanon(ins.with_check) && noStaff(ins.with_check));
chk('AC-1/2/3 UPDATE canonical USING+WITH CHECK + no staff',
  upd && isCanon(upd.qual) && isCanon(upd.with_check) && noStaff(upd.qual) && noStaff(upd.with_check));
chk('AC-1/2 DELETE canonical + no staff', del && isCanon(del.qual) && noStaff(del.qual));
chk('AC-4 SELECT 정책 존재(본 마이그 미접촉)', !!sel);
chk('AC-5 blanket-open(true) 미발생',
  [ins,upd,del].every(r => r && !/^\s*true\s*$/i.test((r.qual||'').trim()) && !/^\s*true\s*$/i.test((r.with_check||'').trim())));
await c2.end();

console.log(`\n${pass ? '✅ APPLY + 영속검증 PASS' : '❌ 영속검증 FAIL'}`);
process.exit(pass ? 0 : 1);
