/**
 * T-20260620-foot-STAFFPHRASE-EDIT-UNLOCK — DA CONSULT-REPLY (MSG-20260620-113909-hgy6) BLOCKER 실측
 * DA 요청 2스텝: (1) SELECT DISTINCT role FROM user_profiles  (2) user_profiles.role CHECK constraint 정의.
 * + 검증 보강: active 분포, DA 5-role set ∩ 실enum 교집합, prod 정책 적용 여부(pg_policies).
 * READ-ONLY (SELECT만). 데이터 변경 없음.
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
console.log(`✅ DB 연결 (READ-ONLY)  ${new Date().toISOString()}\n`);

const DA_SET = ['consultant','coordinator','therapist','part_lead','staff'];

// (1) DISTINCT role + active 분포
const r1 = await c.query(`SELECT role, COUNT(*) total, COUNT(*) FILTER (WHERE active) active
  FROM public.user_profiles GROUP BY role ORDER BY role`);
console.log('── Q1. user_profiles.role 분포 (total / active) ──');
for (const row of r1.rows) console.log(`  ${String(row.role).padEnd(12)} total=${row.total}  active=${row.active}`);
const distinctRoles = r1.rows.map(r => r.role);

// (2) CHECK constraint 정의
const r2 = await c.query(`SELECT con.conname, pg_get_constraintdef(con.oid) def
  FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = cl.relnamespace
  WHERE ns.nspname='public' AND cl.relname='user_profiles' AND con.contype='c'`);
console.log('\n── Q2. user_profiles CHECK constraint ──');
for (const row of r2.rows) console.log(`  ${row.conname}: ${row.def}`);

// enum 파싱
let enumRoles = [];
const roleCheck = r2.rows.find(r => /role/i.test(r.def));
if (roleCheck) enumRoles = [...roleCheck.def.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

// (3) 교집합 검증
console.log('\n── 검증: DA 5-role set ∩ 실 enum ──');
for (const r of DA_SET) {
  const inEnum = enumRoles.includes(r);
  const inData = distinctRoles.includes(r);
  const activeCnt = (r1.rows.find(x => x.role === r) || {}).active || 0;
  console.log(`  ${r.padEnd(12)} enum=${inEnum?'✅':'❌'}  data=${inData?'있음':'없음'}  active=${activeCnt}`);
}
const missing = DA_SET.filter(r => !enumRoles.includes(r));
console.log(`\n  enum 누락 role: ${missing.length ? missing.join(',') : '없음 ✅ (DA set 전부 enum 유효)'}`);
// enum 안에 있으나 DA set·관리자 제외인 직원 role (lock-out-in-disguise 위험)
const COVERED = [...DA_SET, 'admin', 'manager', 'director', 'tm', 'technician'];
const uncovered = distinctRoles.filter(r => !COVERED.includes(r));
console.log(`  데이터에 있으나 어느 정책도 커버 못하는 role: ${uncovered.length ? uncovered.join(',') : '없음 ✅'}`);

// (4) prod 정책 적용 여부
const r4 = await c.query(`SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
  WHERE schemaname='public' AND tablename='phrase_templates' ORDER BY policyname`);
console.log('\n── phrase_templates RLS 정책 (prod 실재) ──');
for (const row of r4.rows) console.log(`  ${row.policyname} [${row.cmd}] roles=${row.roles}`);
const hasStaffPolicy = r4.rows.some(r => r.policyname === 'staff_write_staffarea_phrases');
const hasAdminPolicy = r4.rows.some(r => r.policyname === 'admin_write_phrase_templates');
console.log(`\n  staff_write_staffarea_phrases 존재: ${hasStaffPolicy?'✅ (배포됨)':'❌ (미배포)'}`);
console.log(`  admin_write_phrase_templates 무변경 존재: ${hasAdminPolicy?'✅':'❌'}`);

await c.end();
