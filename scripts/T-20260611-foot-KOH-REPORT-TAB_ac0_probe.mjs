/**
 * T-20260611-foot-KOH-REPORT-TAB  AC-0 read-only 조사 (영속 변경 없음, SELECT only)
 *  1) check_in_services 스키마 + KOH 코드 매칭 방식
 *  2) check_ins → 당일 진료 의사 조회 경로
 *  3) '발톱 부위' 저장 위치 — 미저장이면 BLOCK 회신
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
const log = (...a) => console.log(...a);
log(`✅ DB 연결 (READ-ONLY)  ${new Date().toISOString()}\n`);

async function cols(tbl) {
  const r = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [tbl]);
  log(`── ${tbl} 컬럼 (${r.rowCount}) ──`);
  for (const c of r.rows) log(`   ${c.column_name} : ${c.data_type}`);
  log('');
  return r.rows.map(x => x.column_name);
}

// 0) 어떤 테이블이 존재하나
const tbls = await client.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public'
    AND (table_name ILIKE '%check_in%' OR table_name ILIKE '%service%' OR table_name ILIKE '%diagnos%'
         OR table_name ILIKE '%koh%' OR table_name ILIKE '%checklist%' OR table_name ILIKE '%health_q%')
   ORDER BY table_name`);
log('── 관련 테이블 목록 ──');
for (const t of tbls.rows) log('   ' + t.table_name);
log('');

// 1) check_in_services
let cisCols = [];
try { cisCols = await cols('check_in_services'); } catch(e){ log('check_in_services 없음: '+e.message); }
try { await cols('services'); } catch(e){ log('services 없음'); }
try { await cols('check_ins'); } catch(e){ log('check_ins 없음'); }

// 1b) KOH 코드 매칭 — services / diagnosis 어디에 DX-KOH-01 / D6591 / D620300HZ 가 있나
const KOH = ['DX-KOH-01','D6591','D620300HZ','D6203','KOH'];
for (const tbl of ['services','check_in_services','diagnosis_names','claim_diagnoses']) {
  try {
    const cs = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,[tbl])).rows.map(r=>r.column_name);
    const codeCols = cs.filter(c => /code|name|slug|key/i.test(c));
    if (!codeCols.length) continue;
    for (const cc of codeCols) {
      const r = await client.query(
        `SELECT DISTINCT ${cc} FROM ${tbl} WHERE ${cc} ILIKE ANY($1) LIMIT 20`,
        [KOH.map(k=>`%${k}%`)]);
      if (r.rowCount) { log(`★ ${tbl}.${cc} 매칭:`); for (const x of r.rows) log('     '+JSON.stringify(x)); }
    }
  } catch(e){ /* skip */ }
}
log('');

// 2) services 테이블에서 KOH 관련 행 전체
try {
  const r = await client.query(
    `SELECT * FROM services WHERE name ILIKE '%균%' OR name ILIKE '%KOH%' OR service_code ILIKE ANY($1) LIMIT 20`,
    [KOH.map(k=>`%${k}%`)]);
  log(`── services KOH 후보 (${r.rowCount}) ──`);
  for (const x of r.rows) log('   '+JSON.stringify(x));
  log('');
} catch(e){ log('services KOH 조회 실패: '+e.message); }

// 3) check_ins → 의사 경로
try {
  const c = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='check_ins'
      AND (column_name ILIKE '%doctor%' OR column_name ILIKE '%staff%' OR column_name ILIKE '%physician%' OR column_name ILIKE '%assigned%')`);
  log('── check_ins 의사관련 컬럼 ──');
  for (const x of c.rows) log('   '+x.column_name);
  log('');
} catch(e){ log(e.message); }

// 4) '발톱 부위' 저장 위치 — checklist / health_q / check_in_services 등
log('── 발톱 부위(nail_locations) 저장처 탐색 ──');
for (const tbl of ['checklists','tablet_checklists','health_q_responses','health_questionnaires','check_ins','check_in_services','koh_results']) {
  try {
    const cs = (await client.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,[tbl])).rows;
    if (!cs.length) continue;
    const hit = cs.filter(c => /nail|발톱|location|toe|finding|part|site|position/i.test(c.column_name));
    const jsonbCols = cs.filter(c => c.data_type==='jsonb').map(c=>c.column_name);
    log(`   [${tbl}] 직접컬럼: ${hit.map(h=>h.column_name).join(', ')||'없음'} | jsonb: ${jsonbCols.join(', ')||'없음'}`);
  } catch(e){ /* */ }
}
log('');
// 4b) jsonb 안에 nail_locations 키가 실제로 들어있나 (샘플)
for (const [tbl,col] of [['checklists','data'],['tablet_checklists','data'],['health_q_responses','answers'],['health_q_responses','data']]) {
  try {
    const r = await client.query(
      `SELECT count(*) c FROM ${tbl} WHERE ${col} ? 'nail_locations'`);
    if (Number(r.rows[0].c) > 0) log(`★ ${tbl}.${col} 에 nail_locations 키 보유 행: ${r.rows[0].c}`);
  } catch(e){ /* */ }
}

await client.end();
log('\n✅ AC-0 조사 종료');
