/**
 * T-20260620-foot-DOCLIST-ORDER-10 — 운영 form_templates 실제 목록 read-only 점검.
 * 결제미니창/차트 서류출력 목록 매핑(특히 #9 진료기록사본·#10 처방전 동의어, #3 KOH) 확정용.
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

const r = await c.query(`
  SELECT category, form_key, name_ko, active, sort_order, required_role
  FROM form_templates
  WHERE category IN ('foot-service','insurance')
  ORDER BY category, sort_order, name_ko`);
console.log('=== form_templates (foot-service + insurance) ===');
for (const x of r.rows) {
  console.log(`[${x.category}] sort=${String(x.sort_order).padStart(3)} active=${x.active} ${x.form_key.padEnd(26)} | ${x.name_ko}`);
}
console.log(`\n총 ${r.rows.length}행`);
await c.end();
