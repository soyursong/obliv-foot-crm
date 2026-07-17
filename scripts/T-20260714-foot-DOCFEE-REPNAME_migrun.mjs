/**
 * T-20260714-foot-DOCFEE bill_receipt_new seed — dry-run(무영속) → apply → ledger verify.
 * Migration Dry-Run No-Persistence Protocol 준수: dry-run 은 BEGIN...ROLLBACK 로 무영속 확인.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const tok=(env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim();
const REF='rxlomoozakkjesdqjtvd';
const CLINIC='74967aea-a60b-4da3-a0e7-9c997a930bc8';
const q=async(sql)=>{const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return t.trim()?JSON.parse(t):[];};
const seed = readFileSync('supabase/migrations/20260715180000_foot_docfee_bill_receipt_new_seed.sql','utf8');
const mode = process.argv[2] || 'dryrun';

const exists = async () => (await q(`SELECT count(*)::int n FROM public.form_templates WHERE clinic_id='${CLINIC}' AND form_key='bill_receipt_new'`))[0].n;

if (mode === 'dryrun') {
  const before = await exists();
  // 무영속: BEGIN + seed(주석·txn제어문 없음) + 사후 introspect + ROLLBACK
  await q(`BEGIN; ${seed} ROLLBACK;`);
  const after = await exists();
  console.log(JSON.stringify({ mode, count_before: before, count_after_rollback: after, no_persistence: before===after }, null, 2));
} else if (mode === 'apply') {
  await q(seed);
  const rows = await q(`SELECT id, form_key, category, name_ko, template_format, sort_order, active, required_role FROM public.form_templates WHERE clinic_id='${CLINIC}' AND form_key='bill_receipt_new'`);
  // 기존 bill_receipt(sort35) 무접촉 확인
  const old = await q(`SELECT id, form_key, name_ko, sort_order FROM public.form_templates WHERE clinic_id='${CLINIC}' AND form_key='bill_receipt'`);
  console.log(JSON.stringify({ mode, seeded: rows, old_bill_receipt_intact: old }, null, 2));
}
