/**
 * T-20260617-foot-RXCODES-WRITE-RLS-CANONICAL — APPLY (영속)
 * dev-foot 직접 DB 적용 (메모리 'dev-foot DB 마이그레이션 직접 실행', supabase db push 우회: pg 직접 연결).
 * data-architect CONSULT-REPLY: GO + ADDITIVE(Y), write-only 스코프 한정. 커밋 f22d8b1b.
 *
 * 흐름: 1) 적용 전 pg_policies READ-only 스냅(RC 재확인: read_all[SELECT true] 단 1개)
 *       2) 마이그(BEGIN/COMMIT 내장) 그대로 실행
 *       3) 별도 연결로 영속 검증 — admin_all[ALL] is_admin_or_manager() + read_all[SELECT true] 유지
 * 실패 시 rollback 마이그(20260617150000_..._rollback.sql)로 복구.
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

const migPath = 'supabase/migrations/20260617150000_prescription_codes_write_rls_canonical.sql';
const sql = fs.readFileSync(migPath, 'utf8');

const qPol = `SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
   WHERE schemaname='public' AND tablename='prescription_codes' ORDER BY cmd, policyname`;
const dump = (rows, label) => {
  console.log(`\n── ${label} ──`);
  for (const r of rows) {
    console.log(`  prescription_codes.${r.policyname} [${r.cmd}] roles=${r.roles}`);
    if (['SELECT','ALL','UPDATE','DELETE'].includes(r.cmd) && r.qual) console.log(`      USING: ${(r.qual||'').replace(/\s+/g,' ')}`);
    if (['INSERT','ALL','UPDATE'].includes(r.cmd) && r.with_check) console.log(`      WITH CHECK: ${(r.with_check||'').replace(/\s+/g,' ')}`);
  }
};

// ── 0) 적용 전 READ-only 스냅 (RC 재확인) ──
const c0 = conn();
await c0.connect();
console.log(`✅ DB 연결 (PRE-SNAP)  ${new Date().toISOString()}`);
const before = await c0.query(qPol);
dump(before.rows, '적용 전 pg_policies');
const hadAdminAll = before.rows.some(r => r.policyname === 'prescription_codes_admin_all');
console.log(`\n  적용 전 admin_all 존재? ${hadAdminAll ? '있음(이미 적용됨 → 멱등 재적용)' : '없음(GAP 확인 = RC 일치)'}`);
await c0.end();

// ── 1) APPLY ──
const c1 = conn();
await c1.connect();
console.log(`\n✅ DB 연결 (APPLY)`);
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
dump(after.rows, '적용 후 pg_policies (신규 연결, 영속 확인)');

const adminAll = after.rows.find(r => r.policyname === 'prescription_codes_admin_all');
const readAll  = after.rows.find(r => r.policyname === 'prescription_codes_read_all');
const isCanonWrite = (s) => /is_admin_or_manager\(\)/.test(s||'') && !/FROM staff/.test(s||'');

let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };
console.log('\n── 영속 회귀가드 (architect 검증항목) ──');
chk('admin_all 존재 + cmd=ALL + roles={authenticated}', adminAll && adminAll.cmd === 'ALL' && /authenticated/.test(adminAll.roles));
chk('admin_all USING = is_admin_or_manager() (no staff subquery)', adminAll && isCanonWrite(adminAll.qual));
chk('admin_all WITH CHECK = is_admin_or_manager() (no staff subquery)', adminAll && isCanonWrite(adminAll.with_check));
chk('read_all 미접촉 — [SELECT] USING(true) 그대로 존재', readAll && readAll.cmd === 'SELECT' && /^\s*true\s*$/i.test((readAll.qual||'').trim()));
chk('blanket-open(true) write 미발생 (admin_all USING/CHECK ≠ true)',
  adminAll && !/^\s*true\s*$/i.test((adminAll.qual||'').trim()) && !/^\s*true\s*$/i.test((adminAll.with_check||'').trim()));
await c2.end();

console.log(`\n${pass ? '✅ APPLY + 영속검증 PASS' : '❌ 영속검증 FAIL'}`);
process.exit(pass ? 0 : 1);
