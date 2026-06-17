/**
 * T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — 결정#2 surface 확인용 READ-ONLY COUNT
 * '자체' 배지는 prescription_codes.code_source='custom' 일 때만 노출.
 * 노출 surface 2곳:
 *   (1) doctor/DrugFolderTree.tsx (MedicalChartPanel 내부) L164-166
 *   (2) admin/PrescriptionSetsTab.tsx 약 검색결과 L409-411
 * 배지가 실제 렌더되려면 custom 약이 (a) 마스터에 존재 (b) 약폴더(drug_folder_items)에 편입되어야 함.
 * SELECT only. UPDATE/DELETE 절대 금지(Step3 보류).
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
if (!DB_PASSWORD) { console.error('SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});
await client.connect();
console.log(`DB 연결 (READ-ONLY)  ${new Date().toISOString()}\n`);

// 1) code_source 분포
const dist = await client.query(
  `SELECT code_source, count(*) c FROM prescription_codes GROUP BY code_source ORDER BY c DESC`);
console.log('[prescription_codes.code_source 분포]');
dist.rows.forEach(r => console.log(`  ${r.code_source ?? '(null)'}: ${r.c}`));

// 2) custom 약 샘플 (배지 대상)
const custom = await client.query(
  `SELECT id, name_ko, claim_code, classification FROM prescription_codes
   WHERE code_source='custom' ORDER BY name_ko LIMIT 20`);
console.log(`\n[custom 약 (자체 배지 대상) ${custom.rowCount}건 샘플]`);
custom.rows.forEach(r => console.log(`  ${r.name_ko}  claim_code=${r.claim_code ?? '(null)'}  cls=${r.classification ?? '-'}`));

// 3) custom 약 중 약폴더 편입 = DrugFolderTree(진료차트) 실노출 대상
const inFolder = await client.query(
  `SELECT count(DISTINCT pc.id) c
   FROM prescription_codes pc
   JOIN drug_folder_items dfi ON dfi.prescription_code_id = pc.id
   WHERE pc.code_source='custom'`);
console.log(`\n[custom 약 중 약폴더 편입(=DrugFolderTree 실노출): ${inFolder.rows[0].c}건]`);

await client.end();
console.log('\nREAD-ONLY 완료. UPDATE 0건.');
