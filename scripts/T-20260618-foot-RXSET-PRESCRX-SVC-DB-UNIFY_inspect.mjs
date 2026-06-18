/**
 * T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY — INSPECT (read-only)
 * prescription_codes ↔ services(category_label='처방약') 스키마/데이터 정찰.
 * service_id ADD COLUMN backfill name 매칭 대상 산출용. 데이터 무변경.
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

const c = conn();
await c.connect();
console.log('✅ DB 연결 (INSPECT, read-only)', new Date().toISOString(), '\n');

// 1) prescription_codes 컬럼
const pcCols = await c.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
  WHERE table_schema='public' AND table_name='prescription_codes' ORDER BY ordinal_position`);
console.log('── prescription_codes 컬럼 ──');
for (const r of pcCols.rows) console.log(`  ${r.column_name} ${r.data_type} ${r.is_nullable==='YES'?'NULL':'NOT NULL'}`);

// service_id 이미 존재?
const hasSvcId = pcCols.rows.some(r => r.column_name === 'service_id');
console.log(`\n  service_id 컬럼 존재? ${hasSvcId}`);

// 2) services 컬럼
const svcCols = await c.query(`SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='services' ORDER BY ordinal_position`);
console.log('\n── services 컬럼 ──');
console.log('  ' + svcCols.rows.map(r=>r.column_name).join(', '));

// 3) services category_label 분포
const svcCat = await c.query(`SELECT category_label, count(*) FROM services GROUP BY category_label ORDER BY 2 DESC`);
console.log('\n── services.category_label 분포 ──');
for (const r of svcCat.rows) console.log(`  ${r.category_label}: ${r.count}`);

// 4) services 처방약 행
const svcRx = await c.query(`SELECT id, name FROM services WHERE category_label='처방약' ORDER BY name`);
console.log(`\n── services 처방약 (category_label='처방약') = ${svcRx.rows.length}건 ──`);
for (const r of svcRx.rows) console.log(`  [${r.id.slice(0,8)}] ${r.name}`);

// 5) prescription_codes 행 (name_ko + 주요 메타)
const pcRows = await c.query(`SELECT id, name_ko AS name, claim_code, code_type, classification, insurance_status FROM prescription_codes ORDER BY name_ko`);
console.log(`\n── prescription_codes = ${pcRows.rows.length}건 ──`);
for (const r of pcRows.rows) console.log(`  [${r.id.slice(0,8)}] name_ko="${r.name}" claim=${r.claim_code} type=${r.code_type} cls=${r.classification} ins=${r.insurance_status||''}`);

// 6) name 매칭 시뮬레이션 (정확매칭 + trim)
const norm = (s) => (s||'').trim().replace(/\s+/g,' ');
const svcByName = new Map();
for (const r of svcRx.rows) {
  const k = norm(r.name);
  if (!svcByName.has(k)) svcByName.set(k, []);
  svcByName.get(k).push(r);
}
console.log('\n── name 매칭 시뮬레이션 (prescription_codes → services 처방약) ──');
let exact=0, ambig=0, miss=0;
const missList=[], ambigList=[];
for (const p of pcRows.rows) {
  const k = norm(p.name);
  const hits = svcByName.get(k) || [];
  if (hits.length === 1) { exact++; console.log(`  ✅ EXACT  "${p.name}" → svc ${hits[0].id.slice(0,8)}`); }
  else if (hits.length > 1) { ambig++; ambigList.push(p.name); console.log(`  ⚠️  AMBIG  "${p.name}" → ${hits.length} services 후보`); }
  else { miss++; missList.push(p.name); console.log(`  ❌ MISS   "${p.name}" → services 처방약에 없음`); }
}
console.log(`\n── 요약 ──`);
console.log(`  EXACT(자동매핑 가능): ${exact}`);
console.log(`  AMBIG(사람확인 필요): ${ambig}  ${ambigList.length?'→ '+ambigList.join(', '):''}`);
console.log(`  MISS (services 신설 후보): ${miss}  ${missList.length?'→ '+missList.join(', '):''}`);

await c.end();
