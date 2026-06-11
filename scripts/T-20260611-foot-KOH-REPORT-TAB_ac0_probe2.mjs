/** AC-0 심층 조사 2 — 의사 경로 + 발톱부위 실데이터 (READ-ONLY) */
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
log(`✅ DB 연결 (READ-ONLY)\n`);

// A) staff role 종류 (의사 식별)
const roles = await client.query(`SELECT role, count(*) c FROM staff GROUP BY role ORDER BY role`);
log('── staff role 분포 ──'); for (const r of roles.rows) log(`   ${r.role} : ${r.c}`); log('');

// B) 의사 staff 목록
try {
  const docs = await client.query(`SELECT id, name, display_name, role FROM staff WHERE role ILIKE '%doctor%' OR role ILIKE '%의사%' OR role ILIKE '%physician%'`);
  log(`── 의사 staff (${docs.rowCount}) ──`); for (const d of docs.rows) log('   '+JSON.stringify(d)); log('');
} catch(e){ log(e.message); }

// C) check_in_room_logs 구조 (의사 처리 흔적?)
const rl = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='check_in_room_logs' ORDER BY ordinal_position`);
log('── check_in_room_logs 컬럼 ──'); for (const c of rl.rows) log(`   ${c.column_name}:${c.data_type}`); log('');

// D) KOH 검사 실제 발생한 check_in 샘플 — 의사 누구로 귀속? (D620300HZ or KOH service_id)
const kohServiceIds = ['8e401f7f-6746-4807-9366-4e1d9cfb1e7d','62cb8022-7e19-423f-9d87-b5545a53c7cd','6e0e1a46-b5c0-4596-a6dc-e0cd9d69fb5b'];
const sample = await client.query(
  `SELECT cis.check_in_id, cis.service_name, cis.created_at,
          ci.consultant_id, ci.therapist_id, ci.technician_id, ci.assigned_counselor_id,
          ci.doctor_note IS NOT NULL AS has_docnote, ci.doctor_confirmed_at, ci.created_date,
          ci.customer_name
     FROM check_in_services cis JOIN check_ins ci ON ci.id = cis.check_in_id
    WHERE cis.service_id = ANY($1) OR cis.service_name ILIKE '%KOH%' OR cis.service_name ILIKE '%진균%'
    ORDER BY cis.created_at DESC LIMIT 15`, [kohServiceIds]);
log(`── KOH 검사 발생 check_in 샘플 (${sample.rowCount}) ──`);
for (const s of sample.rows) log('   '+JSON.stringify(s)); log('');

// E) 발톱부위: checklists.checklist_data 에 nail_locations 키 보유 행 수
for (const [tbl,col] of [['checklists','checklist_data'],['check_ins','notes'],['check_ins','treatment_memo']]) {
  try {
    const r = await client.query(`SELECT count(*) c FROM ${tbl} WHERE ${col} ? 'nail_locations'`);
    log(`   ${tbl}.${col} nail_locations 키 보유 행: ${r.rows[0].c}`);
  } catch(e){ log(`   ${tbl}.${col} 조회 실패: ${e.message}`); }
}
// E2) checklist_data 안 nail_locations 샘플 값
try {
  const r = await client.query(`SELECT checklist_data->'nail_locations' v FROM checklists WHERE checklist_data ? 'nail_locations' AND jsonb_array_length(checklist_data->'nail_locations')>0 LIMIT 5`);
  log(`── checklist_data.nail_locations 샘플값 (${r.rowCount}) ──`); for (const x of r.rows) log('   '+JSON.stringify(x.v));
} catch(e){ log('   nail_locations 샘플 실패: '+e.message); }
log('');

// F) checklists ↔ check_in 연결 키
const chk = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='checklists' ORDER BY ordinal_position`);
log('── checklists 컬럼 ──'); for (const c of chk.rows) log(`   ${c.column_name}:${c.data_type}`);

await client.end();
log('\n✅ 종료');
