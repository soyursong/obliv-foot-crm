/**
 * T-20260609-foot-SMS-BRANCHNAME-FIX (P1) — 수동 SMS 미리보기 {지점명} 치환값 오류 재현/캡처 (READ-ONLY)
 *
 * 가설 절단:
 *  A) clinicId 불일치: FE clinics.name(세션 clinicId) vs EF 발송 clinics.name(예약 clinic_id) 불일치
 *  B) 소스 자체 틀림: clinics.name 이 현장 기대 표시명과 다름 (별도 표시명 필드?)
 *  C) 미치환 타이밍
 *
 * 실행: node scripts/diag_sms_branchname_20260609.mjs
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
if (!DB_PASSWORD) { console.error('SUPABASE_DB_PASSWORD 필요'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

async function q(label, sql, params=[]) {
  try {
    const r = await client.query(sql, params);
    console.log(`\n=== ${label} (${r.rowCount} rows) ===`);
    console.table(r.rows);
    return r.rows;
  } catch (e) {
    console.log(`\n=== ${label} ERROR: ${e.message} ===`);
    return [];
  }
}

await client.connect();

// 1) clinics: name 외 표시명 후보 컬럼 전부 (B 가설)
await q('clinics 컬럼 목록', `
  select column_name, data_type
  from information_schema.columns
  where table_name='clinics' order by ordinal_position
`);

await q('clinics 전체 (모든 컬럼)', `select * from clinics order by created_at nulls last`);

// 2) clinic_messaging_capability: 발신번호 + 별도 표시명 후보
await q('clinic_messaging_capability 컬럼', `
  select column_name, data_type
  from information_schema.columns
  where table_name='clinic_messaging_capability' order by ordinal_position
`);
await q('clinic_messaging_capability 데이터', `select * from clinic_messaging_capability`);

// 3) 최근 manual_send 실발송 본문 (FE가 만든 body 그대로 = EF 발송값)
await q('최근 manual_send 발송 이력 10건', `
  select nl.created_at, nl.clinic_id, c.name as clinic_name, nl.status,
         nl.body_rendered, nl.error_message
  from notification_logs nl
  left join clinics c on c.id = nl.clinic_id
  where nl.event_type='manual_send'
  order by nl.created_at desc limit 10
`);

// 4) 최근 자동발송(resv_*) 실발송 본문 — 같은 지점 비교용
await q('최근 자동발송 resv_* 이력 10건', `
  select nl.created_at, nl.clinic_id, c.name as clinic_name, nl.event_type, nl.status,
         nl.body_rendered
  from notification_logs nl
  left join clinics c on c.id = nl.clinic_id
  where nl.event_type like 'resv_%'
  order by nl.created_at desc limit 10
`);

// 5) 템플릿 본문 (지점명 포함 여부)
await q('notification_templates {지점명} 포함', `
  select t.clinic_id, c.name as clinic_name, t.event_type, t.is_active, t.body
  from notification_templates t
  left join clinics c on c.id = t.clinic_id
  where t.body like '%{지점명}%'
  order by t.clinic_id, t.event_type
`);

await client.end();
console.log('\n[done]');
