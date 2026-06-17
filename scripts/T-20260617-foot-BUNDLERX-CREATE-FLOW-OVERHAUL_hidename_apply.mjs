/**
 * T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL — Part C '이름 숨기기' APPLY (영속)
 * prescription_sets 에 hide_name BOOLEAN NULL DEFAULT false (ADDITIVE 1컬럼) 부여.
 * data-architect CONSULT GO(MSG-20260617-203508-xyql): ADDITIVE 무조건 GO, CEO 게이트 면제(§3.1).
 *   TAG tag_meta(20260615120000) 선례 위 4번째 동형 적층. NULL→false=현행 OFF(이름표시) 보존, 회귀 0.
 *
 * dev-foot 직접 DB 적용 (대시보드 수동 실행 금지 정책). 마이그 파일(BEGIN/COMMIT·검증 DO 내장) 그대로 실행 후
 * 별도 연결로 information_schema 영속 검증. 멱등(ADD COLUMN IF NOT EXISTS) → 재실행 no-op.
 * 회귀 시 rollback 마이그(20260617120000_rxset_hide_name.rollback.sql)로 복구.
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

const migPath = 'supabase/migrations/20260617120000_rxset_hide_name.sql';
const sql = fs.readFileSync(migPath, 'utf8');

const qCol = `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
   WHERE table_schema='public' AND table_name='prescription_sets'
     AND column_name='hide_name'`;

// ── 1) APPLY ──
const c1 = conn();
await c1.connect();
console.log(`✅ DB 연결 (APPLY)  ${new Date().toISOString()}\n`);
try {
  await c1.query(sql); // 파일 내 BEGIN..COMMIT (검증 DO 블록 포함)
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
const cols = (await c2.query(qCol)).rows;
console.log('\n── 적용 후 prescription_sets.hide_name (신규 연결, 영속 확인) ──');
for (const r of cols) {
  console.log(`  ${r.column_name} : ${r.data_type} (nullable=${r.is_nullable}, default=${r.column_default})`);
}
await c2.end();

let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };
console.log('\n── 영속 회귀가드 ──');
chk('hide_name boolean nullable', cols.some(r => r.column_name === 'hide_name' && r.data_type === 'boolean' && r.is_nullable === 'YES'));
chk('default false', cols.some(r => r.column_name === 'hide_name' && String(r.column_default).includes('false')));
chk('1컬럼 존재(ADDITIVE)', cols.length === 1);

console.log(`\n${pass ? '✅ APPLY + 영속검증 PASS' : '❌ 영속검증 FAIL'}`);
process.exit(pass ? 0 : 1);
