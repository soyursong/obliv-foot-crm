/* READ-ONLY — Bucket A/B 분류용 6행 임상내용 비교 */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let P = process.env.SUPABASE_DB_PASSWORD;
if (!P && fs.existsSync('.env')) for (const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const c=new Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
await c.connect();
const ids=["ca4d1d7f-d5ef-4ce6-b85e-962cd18a3a49","2b47470d-22c9-4e72-a66e-4c978d31e525","cad6c886-cf14-4540-a725-a795407dee1d","029886ae-5e3c-434f-99ad-7eec23e2c5d1","38ab3b9e-aaee-442b-a160-ccd71a9a2f91","4ec7cf1b-669a-42b7-96a8-a5e24927c350"];
const r=await c.query(`SELECT id, customer_id, visit_date, created_at,
  signing_doctor_name, created_by_name,
  length(coalesce(chief_complaint,'')) lc, length(coalesce(diagnosis,'')) ld,
  length(coalesce(treatment_record,'')) lt, length(coalesce(clinical_progress,'')) lp,
  length(coalesce(treatment_result,'')) lr, length(coalesce(materials_used,'')) lm,
  coalesce(jsonb_array_length(prescription_items),0) rx,
  left(coalesce(chief_complaint,''),40) cc, left(coalesce(diagnosis,''),40) dg,
  left(coalesce(clinical_progress,''),60) cp, left(coalesce(treatment_record,''),60) tr
  FROM medical_charts WHERE id = ANY($1) ORDER BY customer_id, created_at`,[ids]);
for(const x of r.rows){
  console.log(`\n— id=${x.id.slice(0,8)} cust=${x.customer_id.slice(0,8)} date=${String(x.visit_date).slice(0,15)} created=${x.created_at.toISOString().slice(0,19)}`);
  console.log(`   doctor=${x.signing_doctor_name||'-'} by=${x.created_by_name||'-'} | len cc=${x.lc} dx=${x.ld} tr=${x.lt} prog=${x.lp} res=${x.lr} mat=${x.lm} rx=${x.rx}`);
  console.log(`   cc="${x.cc}" dx="${x.dg}" prog="${x.cp}" tr="${x.tr}"`);
}
await c.end();
