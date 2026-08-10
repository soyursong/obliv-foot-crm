import { q } from './dryrun_lib.mjs';
const run = async (sql) => { const r = await q(sql); return r.result || r; };
const idlist = ["78975d00-9d31-4ac3-848c-0f77c6f0d735","80df7a6b-077d-46db-b9db-31591f3977a4","d7faae9b-8e0b-421a-b68b-483ede6834a3","a0f8c846-9f93-47bf-a79e-57d265d989b6","02594dfa-9428-4405-b640-95ab50ad5e5d","351d34c5-2dd9-4583-bfb3-8e27025777a6","c074025b-cd27-443c-93a9-151d6d4214d4","e72022d0-7cf5-4f42-b5e3-b5162005b454","21a82994-b231-4bcc-94ff-dd9e6c3a4951"].map(i=>`'${i}'`).join(',');

console.log('=== packages detail (회차권) ===');
console.log(JSON.stringify(await run(`SELECT p.customer_id::text, p.id::text pkg_id, p.package_name, p.status, p.total_sessions, p.total_amount, p.paid_amount,
  (SELECT count(*) FROM package_payments pp WHERE pp.package_id=p.id) AS pkgpay_rows,
  (SELECT count(*) FROM package_credit_ledger pl WHERE pl.account_id=p.id) AS ledger_rows
  FROM packages p WHERE p.customer_id IN (${idlist}) ORDER BY p.customer_id;`),null,2));

console.log('\n=== medical_charts detail (의료차트) ===');
console.log(JSON.stringify(await run(`SELECT customer_id::text, id::text chart_id, visit_date, is_deleted, signing_doctor_name, chief_complaint, created_at FROM medical_charts WHERE customer_id IN (${idlist}) ORDER BY customer_id;`),null,2));

console.log('\n=== 발행/의료 서류 계열 count ===');
for (const t of ['insurance_documents','insurance_receipts','insurance_claims','prescriptions','consultation_notes','consent_forms','clinical_images','treatment_photos','patient_file_records']) {
  const r = await run(`SELECT count(*) n FROM ${t} WHERE customer_id IN (${idlist});`);
  console.log(`${t}: ${(r[0]||{}).n}`);
}
