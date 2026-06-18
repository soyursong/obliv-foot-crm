/**
 * T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL — Part A 데이터 비우기 dry-run COUNT (READ-ONLY)
 * §3-1 의무 절차: "싹 비우기" 실범위 확정용 4종 COUNT.
 *   (a) prescription_sets 전체 건수
 *   (b) folder='약' (BUNDLE-MERGE 이관 단독약) 건수
 *   (c) 정상 묶음처방(다약물 favorite) 건수
 *   (d) code_type='이관약' 약 마스터 건수
 * SELECT only. prod write 절대 금지. 추정 DELETE 금지(planner→reporter ①vs② 확인 후 게이트).
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log(`✅ DB 연결 (READ-ONLY)  ${new Date().toISOString()}\n`);

// 0) prescription_sets 스키마 확인 (items/folder/is_favorite/name 컬럼 존재 확인)
const cols = await client.query(
  `SELECT column_name, data_type, is_nullable FROM information_schema.columns
   WHERE table_schema='public' AND table_name='prescription_sets' ORDER BY ordinal_position`);
console.log('[prescription_sets columns]');
console.log('  ' + cols.rows.map(r => `${r.column_name}:${r.data_type}${r.is_nullable === 'YES' ? '?' : ''}`).join(', '));
const colset = new Set(cols.rows.map(r => r.column_name));
const hasFavorite = colset.has('is_favorite');
const hasFolder = colset.has('folder');
const hasItems = colset.has('items');
console.log(`  → is_favorite:${hasFavorite} folder:${hasFolder} items:${hasItems}\n`);

// (a) 전체
const a = await client.query(`SELECT count(*)::int AS n FROM prescription_sets`);
console.log(`(a) prescription_sets 전체           : ${a.rows[0].n} 건`);

// (b) folder='약' (BUNDLE-MERGE 이관 단독약)
let b = { rows: [{ n: 'N/A' }] };
if (hasFolder) b = await client.query(`SELECT count(*)::int AS n FROM prescription_sets WHERE folder = '약'`);
console.log(`(b) folder='약' (이관 단독약 묶음)     : ${b.rows[0].n} 건`);

// (c) 정상 묶음처방 = 다약물(items 길이>=2) favorite. is_favorite 없으면 다약물만으로 근사.
let c = { rows: [{ n: 'N/A' }] };
if (hasItems) {
  const favClause = hasFavorite ? `AND is_favorite = true` : ``;
  const folderClause = hasFolder ? `AND (folder IS DISTINCT FROM '약')` : ``;
  c = await client.query(
    `SELECT count(*)::int AS n FROM prescription_sets
     WHERE jsonb_array_length(COALESCE(items, '[]'::jsonb)) >= 2 ${favClause} ${folderClause}`);
}
console.log(`(c) 정상 묶음처방(다약물${hasFavorite ? ' favorite' : ''}, folder≠약) : ${c.rows[0].n} 건`);

// (d) code_type='이관약' 약 마스터 — prescription_codes 추정
let dTable = null;
for (const t of ['prescription_codes', 'prescription_code']) {
  const reg = await client.query(`SELECT to_regclass($1) AS oid`, [`public.${t}`]);
  if (reg.rows[0].oid) { dTable = t; break; }
}
let d = { rows: [{ n: 'N/A' }] };
if (dTable) {
  const dcols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`, [dTable]);
  const dset = new Set(dcols.rows.map(r => r.column_name));
  if (dset.has('code_type')) {
    d = await client.query(`SELECT count(*)::int AS n FROM ${dTable} WHERE code_type = '이관약'`);
  }
  console.log(`(d) ${dTable}.code_type='이관약' 마스터 : ${d.rows[0].n} 건`);
} else {
  console.log(`(d) code_type='이관약' 마스터        : 테이블 미발견(prescription_codes 부재)`);
}

// 보조: 묶음처방 folder 분포 (범위 판단 보강)
if (hasFolder) {
  const dist = await client.query(
    `SELECT COALESCE(folder, '(NULL)') AS folder, count(*)::int AS n
     FROM prescription_sets GROUP BY folder ORDER BY n DESC`);
  console.log(`\n[folder 분포]`);
  for (const r of dist.rows) console.log(`  ${r.folder}: ${r.n}`);
}

// 보조: items 길이 분포 (단독약 1 vs 묶음 2+)
if (hasItems) {
  const lenDist = await client.query(
    `SELECT jsonb_array_length(COALESCE(items,'[]'::jsonb)) AS len, count(*)::int AS n
     FROM prescription_sets GROUP BY 1 ORDER BY 1`);
  console.log(`\n[items 길이 분포] (1=단독약, 2+=다약물 묶음)`);
  for (const r of lenDist.rows) console.log(`  len ${r.len}: ${r.n}`);
}

await client.end();
console.log(`\n✅ dry-run COUNT 완료 (DELETE 미실행 — reporter ①vs② 확인 게이트 대기)`);
