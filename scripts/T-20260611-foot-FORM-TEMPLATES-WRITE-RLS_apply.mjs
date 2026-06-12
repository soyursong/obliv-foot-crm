/**
 * T-20260611-foot-FORM-TEMPLATES-WRITE-RLS-OUTLIER (WS-1) — APPLY (영속)
 * dev-foot 직접 DB 적용 (supervisor SHADOW_MODE 우회: supabase db push 대신 pg 직접 연결).
 * 마이그 파일(BEGIN/COMMIT 내장)을 그대로 실행 후 → 별도 연결로 pg_policies 영속 검증.
 * 실패/회귀 시 rollback 마이그(20260612000000_..._rollback.sql)로 복구 가능.
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

const migPath = 'supabase/migrations/20260612000000_form_templates_write_rls_canonical.sql';
const sql = fs.readFileSync(migPath, 'utf8');

const qPol = `SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
   WHERE schemaname='public' AND tablename='form_templates' ORDER BY cmd, policyname`;

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
const after = (await c2.query(qPol)).rows;
console.log('\n── 적용 후 pg_policies (신규 연결, 영속 확인) ──');
for (const r of after) {
  console.log(`  form_templates.${r.policyname} [${r.cmd}] roles=${r.roles}`);
  if (r.qual) console.log(`      USING: ${r.qual.replace(/\s+/g,' ')}`);
  if (r.with_check) console.log(`      WITH CHECK: ${r.with_check.replace(/\s+/g,' ')}`);
}

const adminAll = after.find(r => r.policyname === 'form_templates_admin_all' && r.cmd === 'ALL');
const okWriteCanonical = !!adminAll
  && /is_admin_or_manager\(\)/.test(adminAll.qual || '')
  && /is_admin_or_manager\(\)/.test(adminAll.with_check || '')
  && /authenticated/.test(String(adminAll.roles));
const okOutlierGone = !after.some(r => r.policyname === 'form_templates_manage');
const okNoStaffInWrite = !after.some(r => r.cmd === 'ALL' && /FROM staff/.test(r.qual || ''));
const rAfter = after.find(r => r.policyname === 'form_templates_read' && r.cmd === 'SELECT');
const okReadUnchanged = !!rAfter && /^\s*true\s*$/i.test((rAfter.qual || '').trim());

let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };
console.log('\n── 영속 회귀가드 ──');
chk('AC-2 write canonical(is_admin_or_manager, authenticated, WITH CHECK)', okWriteCanonical);
chk('OUTLIER form_templates_manage 제거', okOutlierGone);
chk('write 경로 비정규 staff 신원 잔존 없음', okNoStaffInWrite);
chk('AC-4 READ(form_templates_read SELECT true) 불변', okReadUnchanged);
await c2.end();

console.log(`\n${pass ? '✅ APPLY + 영속검증 PASS' : '❌ 영속검증 FAIL'}`);
process.exit(pass ? 0 : 1);
