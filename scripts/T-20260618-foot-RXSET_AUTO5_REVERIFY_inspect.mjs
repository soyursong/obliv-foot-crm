/**
 * T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY — AC-6c AUTO5 3-KEY 재검증 INSPECT (read-only)
 * 목적: 06-18 --confirm-auto 로 service_id 연결된 쌍을 (상품명,성분명,코드) 3-key 로 재검증.
 * 데이터 변경 없음. 스키마 컬럼 + 실데이터 덤프만.
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

const c = conn(); await c.connect();
console.log('✅ DB 연결 (AUTO5 REVERIFY INSPECT, read-only)', new Date().toISOString(), '\n');

for (const tbl of ['services', 'prescription_codes']) {
  const cols = (await c.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [tbl])).rows;
  console.log(`── ${tbl} 컬럼(${cols.length}) ──`);
  console.log('  ' + cols.map(x => x.column_name).join(', '));
  console.log('');
}

// 현재 service_id 연결된 prescription_codes 전체 (06-18 적용 결과 확인)
const linked = (await c.query(
  `SELECT id, name_ko, service_id FROM prescription_codes WHERE service_id IS NOT NULL ORDER BY name_ko`)).rows;
console.log(`── 현재 service_id 연결된 prescription_codes: ${linked.length}건 ──`);
for (const r of linked) console.log(`  pc[${r.id.slice(0,8)}] "${r.name_ko}" → svc ${r.service_id?.slice(0,8)}`);
console.log('');

await c.end();
console.log('done.');
