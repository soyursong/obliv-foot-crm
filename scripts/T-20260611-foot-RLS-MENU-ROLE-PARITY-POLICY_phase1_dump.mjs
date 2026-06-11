/** Phase 1 보조 — 모호 분류(OTHER/MGMT_ONLY/OUTLIER/NO_SELECT_POLICY) 테이블의 SELECT/ALL 정책 RAW USING 덤프. READ-ONLY. */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) for (const line of fs.readFileSync('.env','utf8').split('\n')) { const m=line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD=m[1].trim(); }
const client = new Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:5432, database:'postgres', user:'postgres.rxlomoozakkjesdqjtvd', password:DB_PASSWORD, ssl:{rejectUnauthorized:false} });
const TARGETS = [
  'chart_doctor_memos','check_in_room_logs','clinic_dashboard_layouts','clinic_events','clinic_memos',
  'clinic_messaging_capability','customer_special_notes','customer_treatment_memos','duty_roster',
  'form_submissions','medical_charts','notification_logs','notification_opt_outs','notification_templates',
  'package_progress_plans','patient_room_daily_log','reservation_registrars','service_menu_order',
  'user_dashboard_layout_overrides','insurance_sync_runs','consultation_notes','leads','tm_call_logs',
  'dopamine_callback_config','dopamine_callback_outbox','customers','daily_closings','document_templates',
];
await client.connect();
console.log(`READ-ONLY ${new Date().toISOString()}\n`);
for (const t of TARGETS) {
  console.log(`\n══════ ${t} ══════`);
  const pol = await client.query(`SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename=$1 ORDER BY cmd, policyname`, [t]);
  if (pol.rowCount===0) { console.log('  (정책 0건)'); continue; }
  for (const p of pol.rows) {
    console.log(`  • ${p.policyname} [${p.cmd}] roles=${JSON.stringify(p.roles)}`);
    if (p.qual) console.log(`      USING: ${p.qual}`);
    if (p.with_check) console.log(`      CHECK: ${p.with_check}`);
  }
}
await client.end();
console.log('\nDONE (write 없음)');
