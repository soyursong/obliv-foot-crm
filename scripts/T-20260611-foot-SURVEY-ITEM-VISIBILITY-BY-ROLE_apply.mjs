/**
 * T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE — APPLY (영속)
 * dev-foot 직접 DB 적용 (supabase db push 대신 pg 직접 연결).
 * 마이그(20260611150000_health_q_rls_canonical_identity.sql, BEGIN/COMMIT 내장)를 실행 후
 *   → 별도 연결로 pg_policies 영속 검증.
 * RC = health_q_results/health_q_tokens SELECT 정책의 비정규 신원소스(staff.user_id) outlier.
 * 수정 = 정규 패턴(is_approved_user() AND clinic_id=current_user_clinic_id())으로 통일. READ-only.
 * 실패/회귀 시 rollback: 20260611150000_health_q_rls_canonical_identity.rollback.sql
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

const migPath = 'supabase/migrations/20260611150000_health_q_rls_canonical_identity.sql';
const sql = fs.readFileSync(migPath, 'utf8');

const qPol = (tbl) => `SELECT policyname, cmd, qual, with_check FROM pg_policies
   WHERE schemaname='public' AND tablename='${tbl}' ORDER BY cmd, policyname`;

// ── 0) 적용 전 스냅샷 (diff 용) ──
const writeCmds = ['INSERT','UPDATE','DELETE'];
const beforeWriteCount = {};
const c0 = conn();
await c0.connect();
console.log(`✅ DB 연결 (BEFORE snapshot)  ${new Date().toISOString()}\n`);
for (const tbl of ['health_q_results', 'health_q_tokens']) {
  const before = await c0.query(qPol(tbl));
  beforeWriteCount[tbl] = before.rows.filter(r => writeCmds.includes(r.cmd)).length;
  console.log(`── BEFORE ${tbl} (write 정책 ${beforeWriteCount[tbl]}개) ──`);
  for (const r of before.rows) {
    console.log(`  ${r.policyname} [${r.cmd}]`);
    if (r.cmd === 'SELECT') console.log(`      USING: ${(r.qual||'').replace(/\s+/g,' ')}`);
  }
}
await c0.end();

// ── 1) APPLY ──
const c1 = conn();
await c1.connect();
console.log(`\n✅ DB 연결 (APPLY)  ${new Date().toISOString()}`);
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
const isCanon = (s) => /is_approved_user\(\)/.test(s||'') && /current_user_clinic_id\(\)/.test(s||'');
const noStaff = (s) => !/FROM staff/.test(s||'');

let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };

for (const tbl of ['health_q_results', 'health_q_tokens']) {
  const after = await c2.query(qPol(tbl));
  console.log(`\n── 적용 후 pg_policies — ${tbl} (신규 연결, 영속 확인) ──`);
  for (const r of after.rows) {
    console.log(`  ${tbl}.${r.policyname} [${r.cmd}]`);
    if (r.cmd === 'SELECT') console.log(`      USING: ${(r.qual||'').replace(/\s+/g,' ')}`);
    if (['INSERT','UPDATE'].includes(r.cmd)) console.log(`      WITH CHECK: ${(r.with_check||'').replace(/\s+/g,' ')}`);
  }
  const sel = after.rows.filter(r => r.cmd === 'SELECT');
  const writes = after.rows.filter(r => ['INSERT','UPDATE','DELETE'].includes(r.cmd));

  console.log(`  ── 회귀가드 (${tbl}) ──`);
  chk(`[${tbl}] AC-1/2 SELECT canonical (is_approved_user + current_user_clinic_id)`,
    sel.length > 0 && sel.every(r => isCanon(r.qual)));
  chk(`[${tbl}] AC-1 staff.user_id outlier 제거 (no FROM staff)`,
    sel.every(r => noStaff(r.qual)));
  chk(`[${tbl}] AC-4 clinic 스코프 유지 (current_user_clinic_id 존재)`,
    sel.every(r => /current_user_clinic_id\(\)/.test(r.qual||'')));
  chk(`[${tbl}] AC-5 blanket-open(true) SELECT 미발생`,
    sel.every(r => !/^\s*true\s*$/i.test((r.qual||'').trim())));
}

// ── 3) AC-3 write 정책 불변: BEFORE/AFTER write 정책 수 동일 + hq_tokens INSERT 잔존 ──
const tokAll = await c2.query(qPol('health_q_tokens'));
const resAll = await c2.query(qPol('health_q_results'));
const afterWriteCount = {
  health_q_tokens: tokAll.rows.filter(r => writeCmds.includes(r.cmd)).length,
  health_q_results: resAll.rows.filter(r => writeCmds.includes(r.cmd)).length,
};
console.log('\n── AC-3 write 정책 불변 확인 ──');
chk('hq_tokens_staff_insert(INSERT) 잔존', tokAll.rows.some(r => r.cmd === 'INSERT'));
chk(`health_q_tokens write 정책 수 불변 (${beforeWriteCount.health_q_tokens}→${afterWriteCount.health_q_tokens})`,
  beforeWriteCount.health_q_tokens === afterWriteCount.health_q_tokens);
chk(`health_q_results write 정책 수 불변 (${beforeWriteCount.health_q_results}→${afterWriteCount.health_q_results})`,
  beforeWriteCount.health_q_results === afterWriteCount.health_q_results);

await c2.end();

console.log(`\n${pass ? '✅ APPLY + 영속검증 PASS' : '❌ 영속검증 FAIL'}`);
process.exit(pass ? 0 : 1);
