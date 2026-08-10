import { q } from './dryrun_lib.mjs';
const run = async (sql) => { const r = await q(sql); return r.result || r; };

const TARGETS = {
  '78975d00-9d31-4ac3-848c-0f77c6f0d735':'서류테스트 F-4990',
  '80df7a6b-077d-46db-b9db-31591f3977a4':'서류테스트2 F-5113',
  'd7faae9b-8e0b-421a-b68b-483ede6834a3':'송지현2 F-4692',
  'a0f8c846-9f93-47bf-a79e-57d265d989b6':'엄경은2 F-4691',
  '02594dfa-9428-4405-b640-95ab50ad5e5d':'엄경은2 F-4703(DUMMY)',
  '351d34c5-2dd9-4583-bfb3-8e27025777a6':'총괄테스트중 F-4574',
  'c074025b-cd27-443c-93a9-151d6d4214d4':'풋서류테스트입니다 F-4468',
  'e72022d0-7cf5-4f42-b5e3-b5162005b454':'풋테스트1 F-4427',
  '21a82994-b231-4bcc-94ff-dd9e6c3a4951':'풋테스트3 F-4425',
};
const ids = Object.keys(TARGETS);
const idlist = ids.map(i=>`'${i}'`).join(',');

// tables that reference customer via customer_id, plus special columns
const tblcol = [
  ['reservations','customer_id'],['check_ins','customer_id'],['payments','customer_id'],
  ['service_charges','customer_id'],['packages','customer_id'],['package_payments','customer_id'],
  ['package_credit_ledger','customer_id'],['pending_payment','customer_id'],['payment_code_claims','customer_id'],
  ['insurance_claims','customer_id'],['insurance_documents','customer_id'],['insurance_receipts','customer_id'],
  ['consent_forms','customer_id'],['consultation_notes','customer_id'],['medical_charts','customer_id'],
  ['prescriptions','customer_id'],['clinical_images','customer_id'],['treatment_photos','customer_id'],
  ['progress_result_images','customer_id'],['chart_treatment_requests','customer_id'],['chart_doctor_memos','customer_id'],
  ['checklists','customer_id'],['health_q_results','customer_id'],['health_q_tokens','customer_id'],
  ['health_maintenance_balances','customer_id'],['form_submissions','customer_id'],
  ['customer_consult_memos','customer_id'],['customer_reservation_memos','customer_id'],
  ['customer_special_notes','customer_id'],['customer_treatment_memos','customer_id'],
  ['reservation_memo_history','customer_id'],['message_logs','customer_id'],['notification_logs','customer_id'],
  ['notification_opt_outs','customer_id'],['patient_file_records','customer_id'],['patient_past_history','customer_id'],
  ['patient_room_daily_log','patient_id'],['prescriptions','customer_id'],['tm_call_logs','customer_id'],
  ['cband_payment_attempts','customer_id'],['leads','customer_id'],['rx_audit_log','customer_id'],
  ['phi_access_log','customer_id'],
];
const seen = new Set();
const parts = [];
for (const [t,c] of tblcol) {
  const k=t+'.'+c; if(seen.has(k))continue; seen.add(k);
  parts.push(`SELECT '${t}' tbl, ${c}::text cid, count(*) n FROM ${t} WHERE ${c} IN (${idlist}) GROUP BY ${c}`);
}
const sql = parts.join('\nUNION ALL\n') + '\nORDER BY 2,1;';
const rows = await run(sql);

// pivot into per-customer
const per = {};
for (const id of ids) per[id]={label:TARGETS[id],children:{}};
for (const r of rows) { if(per[r.cid]) per[r.cid].children[r.tbl]=Number(r.n); }

// ledger / 의료법 보존 tables (물리삭제 HOLD 유발)
const LEDGER = new Set(['payments','service_charges','package_payments','packages','package_credit_ledger',
  'insurance_claims','insurance_documents','insurance_receipts','consultation_notes','medical_charts',
  'prescriptions','clinical_images','treatment_photos','consent_forms','patient_file_records','patient_past_history']);

console.log('=== PER-CUSTOMER CHILD/LEDGER CENSUS ===\n');
for (const id of ids) {
  const c=per[id];
  const kids=Object.entries(c.children);
  const ledgerHits=kids.filter(([t])=>LEDGER.has(t));
  const cls = ledgerHits.length>0 ? '(b) 엮임[원장/의료법]' : (kids.length>0 ? '(a?) 자식有(비원장)' : '(a) CLEAN');
  console.log(`--- ${c.label}  [${id}]`);
  console.log(`    분류: ${cls}`);
  if(kids.length===0) console.log('    children: 없음');
  else for(const [t,n] of kids.sort((x,y)=>y[1]-x[1])) console.log(`    ${LEDGER.has(t)?'★':' '} ${t}: ${n}`);
  console.log('');
}
