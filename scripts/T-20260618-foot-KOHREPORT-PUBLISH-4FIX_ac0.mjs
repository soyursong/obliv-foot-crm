/**
 * T-20260618-foot-KOHREPORT-PUBLISH-4FIX — AC-0 선조사 (read-only)
 * 이슈1: 윤민희 환자 customers.birth_date prod 값 존재 여부 → (a)데이터부재 vs (b)바인딩미연결 판별.
 * 이슈4: 발행 lifecycle status(form_submissions/koh_result) 확인 — 신규 상태 필요 여부.
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
const c = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await c.connect();
console.log('✅ DB 연결\n');

// === 이슈1: 윤민희 birth_date ===
console.log('=== 이슈1: 환자 생년(birth_date) 선조사 ===');
const yun = await c.query(
  `SELECT id, name, birth_date, chart_number, clinic_id FROM customers WHERE name = '윤민희' ORDER BY created_at`,
);
console.log(`윤민희 매칭 행 수: ${yun.rows.length}`);
for (const r of yun.rows) {
  console.log(`  id=${r.id} name=${r.name} birth_date=${JSON.stringify(r.birth_date)} chart=${r.chart_number} clinic=${r.clinic_id}`);
}

// birth_date NULL 비율 전체 (모집단 감각)
const stat = await c.query(
  `SELECT count(*) AS total, count(birth_date) AS has_birth, count(*) - count(birth_date) AS null_birth FROM customers`,
);
console.log(`\ncustomers 전체: ${JSON.stringify(stat.rows[0])}`);

// KOH 검사 대상 중 birth_date NULL 인 행 — 발행차단(이슈3) 영향 범위
const kohNull = await c.query(`
  SELECT cu.name, cu.birth_date, cis.service_name, cis.created_at
  FROM check_in_services cis
  JOIN check_ins ci ON ci.id = cis.check_in_id
  JOIN customers cu ON cu.id = ci.customer_id
  WHERE (cis.service_name ILIKE '%KOH%' OR cis.service_name ILIKE '%진균검사%')
    AND cu.birth_date IS NULL
  ORDER BY cis.created_at DESC
  LIMIT 20
`);
console.log(`\nKOH 검사대상 中 birth_date NULL 행: ${kohNull.rows.length}건 (발행차단 영향)`);
for (const r of kohNull.rows) {
  console.log(`  ${r.name} birth=${JSON.stringify(r.birth_date)} svc=${r.service_name} at=${r.created_at}`);
}

// === 이슈4: 발행 lifecycle status ===
console.log('\n=== 이슈4: koh_result 발행 lifecycle status 선조사 ===');
const tpl = await c.query(`SELECT id, clinic_id, form_key FROM form_templates WHERE form_key = 'koh_result'`);
console.log(`koh_result 템플릿: ${tpl.rows.length}건`, tpl.rows.map(r => ({clinic: r.clinic_id})));
const statuses = await c.query(`
  SELECT status, count(*) FROM form_submissions
  WHERE template_id IN (SELECT id FROM form_templates WHERE form_key = 'koh_result')
  GROUP BY status
`);
console.log(`form_submissions(koh_result) status 분포:`, JSON.stringify(statuses.rows));
// status CHECK 제약 — 신규 상태 추가 가능 여부 판단용
const chk = await c.query(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='form_submissions'::regclass AND contype='c'`);
console.log(`form_submissions CHECK 제약:`, JSON.stringify(chk.rows, null, 2));

await c.end();
console.log('\n=== AC-0 선조사 완료 ===');
