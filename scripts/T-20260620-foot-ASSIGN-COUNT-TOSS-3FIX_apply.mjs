/**
 * T-20260620-foot-ASSIGN-COUNT-TOSS-3FIX — AC-1 RC fix APPLY (영속)
 *
 * RC: 마이그 20260618120000_assignment_autoassign.sql(assignment_actions 테이블 +
 *     customers.assigned_consultant_id) 가 prod에 미적용 → 배정 audit(count SSOT)이 부재 →
 *     auto/manual 배정이 check_ins엔 남으나 assignment_actions엔 INSERT 실패(best-effort 삼킴) →
 *     '당월 누적'(assignment_actions count 파생) 0.
 *
 * 본 스크립트: 해당 ADDITIVE 마이그(IF NOT EXISTS, DA dfd8 GO)를 prod에 적용 + 별도 연결로 영속 검증.
 * dev-foot 직접 pg 적용(메모리 'dev-foot DB 마이그레이션 직접 실행') + supervisor DDL-diff QA 게이트.
 * Rollback: 20260618120000_assignment_autoassign.rollback.sql
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

const migPath = 'supabase/migrations/20260618120000_assignment_autoassign.sql';
const sql = fs.readFileSync(migPath, 'utf8');

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
const tbl = await c2.query(`SELECT to_regclass('public.assignment_actions') AS aa`);
const col = await c2.query(`SELECT column_name FROM information_schema.columns WHERE table_name='customers' AND column_name='assigned_consultant_id'`);
const pol = await c2.query(`SELECT policyname, cmd FROM pg_policies WHERE tablename='assignment_actions'`);
const idx = await c2.query(`SELECT indexname FROM pg_indexes WHERE tablename='assignment_actions' ORDER BY indexname`);
const reasonCol = await c2.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='assignment_actions' AND column_name='reason'`);
const toStaffCol = await c2.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='assignment_actions' AND column_name='to_staff_id'`);
await c2.end();

console.log('\n── 적용 후 영속 검증(신규 연결) ──');
let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };
chk(`assignment_actions 테이블 존재 (${tbl.rows[0].aa})`, tbl.rows[0].aa === 'assignment_actions');
chk(`customers.assigned_consultant_id 컬럼 존재`, col.rows.length === 1);
chk(`RLS 정책 assignment_actions_clinic_access 존재`, pol.rows.some(r => r.policyname === 'assignment_actions_clinic_access'));
chk(`인덱스 3종 존재 (현재 ${idx.rows.length})`, idx.rows.length >= 3);
chk(`reason 컬럼 nullable (AC-2 토스사유 — 신규컬럼 불요)`, reasonCol.rows[0]?.is_nullable === 'YES');
chk(`to_staff_id nullable (AC-2 미배정 toss — 신규컬럼 불요)`, toStaffCol.rows[0]?.is_nullable === 'YES');
console.log('  idx:', idx.rows.map(r => r.indexname).join(', '));

console.log(`\n${pass ? '✅ APPLY + 영속검증 PASS' : '❌ 영속검증 FAIL'}`);
process.exit(pass ? 0 : 1);
