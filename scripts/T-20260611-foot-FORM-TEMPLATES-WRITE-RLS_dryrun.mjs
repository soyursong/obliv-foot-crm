/**
 * T-20260611-foot-FORM-TEMPLATES-WRITE-RLS-OUTLIER (WS-1) — DRY-RUN
 * 마이그레이션을 트랜잭션 안에서 적용 → 결과 정책 검증 → ROLLBACK (영속 변경 없음).
 * write OUTLIER 제거 + canonical(is_admin_or_manager) 적용 + READ 불변을 확인만 한다.
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

const migPath = 'supabase/migrations/20260612000000_form_templates_write_rls_canonical.sql';
const sql = fs.readFileSync(migPath, 'utf8')
  .split('\n').filter(l => !/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n');

const dump = async () => (await client.query(
  `SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
     WHERE schemaname='public' AND tablename='form_templates'
     ORDER BY cmd, policyname`)).rows;

const show = (rows, tag) => {
  console.log(`── ${tag} 정책 ──`);
  for (const r of rows) {
    console.log(`  form_templates.${r.policyname} [${r.cmd}] roles=${r.roles}`);
    if (r.qual) console.log(`      USING: ${r.qual.replace(/\s+/g,' ')}`);
    if (r.with_check) console.log(`      WITH CHECK: ${r.with_check.replace(/\s+/g,' ')}`);
  }
};

const before = await dump();
show(before, 'BEFORE');

try {
  await client.query('BEGIN');
  await client.query(sql);
  const after = await dump();
  console.log('');
  show(after, 'AFTER (트랜잭션 내, 미커밋)');

  // 회귀가드 자동 점검
  const adminAll = after.find(r => r.policyname === 'form_templates_admin_all' && r.cmd === 'ALL');
  const okWriteCanonical = !!adminAll
    && /is_admin_or_manager\(\)/.test(adminAll.qual || '')
    && /is_admin_or_manager\(\)/.test(adminAll.with_check || '')
    && /authenticated/.test(String(adminAll.roles));
  const okOutlierGone = !after.some(r => r.policyname === 'form_templates_manage');
  const okNoStaffInWrite = !after.some(r => r.cmd === 'ALL' && /FROM staff/.test(r.qual || ''));
  // READ 불변: form_templates_read [SELECT] USING true 가 before/after 동일하게 존재
  const rBefore = before.find(r => r.policyname === 'form_templates_read' && r.cmd === 'SELECT');
  const rAfter  = after.find(r => r.policyname === 'form_templates_read' && r.cmd === 'SELECT');
  const okReadUnchanged = !!rBefore && !!rAfter && (rBefore.qual || '') === (rAfter.qual || '');

  console.log('\n── 회귀가드 자동 점검 ──');
  console.log(`  AC-2 write canonical(is_admin_or_manager, authenticated, WITH CHECK) : ${okWriteCanonical ? '✅' : '❌'}`);
  console.log(`  OUTLIER form_templates_manage 제거                                  : ${okOutlierGone ? '✅' : '❌'}`);
  console.log(`  write 경로에 비정규 staff 신원 잔존 없음                            : ${okNoStaffInWrite ? '✅' : '❌'}`);
  console.log(`  AC-4 READ(form_templates_read SELECT true) 불변                     : ${okReadUnchanged ? '✅' : '❌'}`);

  await client.query('ROLLBACK');
  console.log('\n↩️  ROLLBACK 완료 — prod 영속 변경 없음.');
  console.log((okWriteCanonical && okOutlierGone && okNoStaffInWrite && okReadUnchanged)
    ? '\n✅ DRY-RUN PASS — SQL 구문/canonical write/OUTLIER 제거/READ 불변 모두 통과.'
    : '\n❌ DRY-RUN FAIL — 위 항목 확인.');
} catch (e) {
  await client.query('ROLLBACK').catch(()=>{});
  console.error('\n❌ DRY-RUN 적용 중 오류 (ROLLBACK 됨):', e.message);
  process.exitCode = 1;
}
await client.end();
