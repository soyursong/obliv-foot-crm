/**
 * T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER — APPLY (영속)
 * prescription_sets 에 set-level 태그/아이콘 메타(ADDITIVE 3컬럼) 부여.
 * data-architect CONSULT GO(MSG-20260615-005324-wrkc): tag_label/tag_color/icon nullable TEXT.
 *
 * dev-foot 직접 DB 적용 (대시보드 수동 실행 금지 정책). 마이그 파일(BEGIN/COMMIT 내장) 그대로 실행 후
 * 별도 연결로 information_schema 영속 검증. 멱등(ADD COLUMN IF NOT EXISTS) → 재실행 no-op.
 * 회귀 시 rollback 마이그(20260615120000_rxset_tag_meta.rollback.sql)로 복구.
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

const migPath = 'supabase/migrations/20260615120000_rxset_tag_meta.sql';
const sql = fs.readFileSync(migPath, 'utf8');

const qCols = `SELECT column_name, data_type, is_nullable FROM information_schema.columns
   WHERE table_schema='public' AND table_name='prescription_sets'
     AND column_name IN ('tag_label','tag_color','icon') ORDER BY column_name`;

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
const cols = (await c2.query(qCols)).rows;
console.log('\n── 적용 후 prescription_sets 태그 컬럼 (신규 연결, 영속 확인) ──');
for (const r of cols) {
  console.log(`  ${r.column_name} : ${r.data_type} (nullable=${r.is_nullable})`);
}
await c2.end();

let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };
console.log('\n── 영속 회귀가드 ──');
chk('tag_label text nullable', cols.some(r => r.column_name === 'tag_label' && r.data_type === 'text' && r.is_nullable === 'YES'));
chk('tag_color text nullable', cols.some(r => r.column_name === 'tag_color' && r.data_type === 'text' && r.is_nullable === 'YES'));
chk('icon text nullable',      cols.some(r => r.column_name === 'icon' && r.data_type === 'text' && r.is_nullable === 'YES'));
chk('3컬럼 모두 존재(ADDITIVE)', cols.length === 3);

console.log(`\n${pass ? '✅ APPLY + 영속검증 PASS' : '❌ 영속검증 FAIL'}`);
process.exit(pass ? 0 : 1);
