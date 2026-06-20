/* T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY — READ-ONLY dedup dry-run (step 3, §B-0b)
   같은날(customer_id,clinic_id,visit_date) 활성 중복행 카운트 + Bucket A/B 분류용 내용 비교.
   읽기 전용. 쓰기 0. */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let P = process.env.SUPABASE_DB_PASSWORD;
if (!P && fs.existsSync('.env')) for (const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const c=new Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
await c.connect();
const cols=await c.query(`SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='medical_charts' ORDER BY ordinal_position`);
console.log('=== medical_charts columns ==='); for(const r of cols.rows) console.log(`  ${r.column_name}\t${r.data_type}\t${r.is_nullable}`);
const hasSoft = cols.rows.some(r=>r.column_name==='is_deleted');
const flt = hasSoft ? 'WHERE is_deleted = false' : '';
console.log(`\n[is_deleted column exists: ${hasSoft}] filter="${flt||'(none)'}"`);
const tot=await c.query(`SELECT count(*) total FROM medical_charts ${flt}`);
console.log('총 활성 행:', tot.rows[0].total);
const dup=await c.query(`SELECT count(*)::int - count(DISTINCT (customer_id, clinic_id, visit_date))::int AS surplus FROM medical_charts ${flt}`);
console.log('동일일 surplus(=잠재 dedup 대상 행수):', dup.rows[0].surplus);
const grp=await c.query(`SELECT customer_id, clinic_id, visit_date, count(*)::int AS n,
   array_agg(id ORDER BY created_at) AS ids,
   array_agg(created_at ORDER BY created_at) AS created_ats,
   array_agg(coalesce(created_by_name,'?') ORDER BY created_at) AS authors
 FROM medical_charts ${flt}
 GROUP BY customer_id, clinic_id, visit_date HAVING count(*) > 1 ORDER BY n DESC, visit_date DESC`);
console.log(`\n=== 동일일 중복 그룹 수: ${grp.rows.length} ===`);
for(const r of grp.rows){ console.log(`  cust=${r.customer_id} clinic=${r.clinic_id} date=${r.visit_date} n=${r.n} authors=${JSON.stringify(r.authors)} ids=${JSON.stringify(r.ids)}`); }
fs.writeFileSync('scripts/T-20260620-foot-MEDCHART-DELETE-SAMEDAY_dryrun.out.json', JSON.stringify({hasSoft,total:tot.rows[0].total,surplus:dup.rows[0].surplus,groups:grp.rows},null,2));
console.log('\n→ 상세 그룹 JSON 저장: scripts/..._dryrun.out.json');
await c.end();
