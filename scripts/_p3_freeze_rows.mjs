import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const tok=(env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim();
const REF='rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(t);return JSON.parse(t);}
const IDS=['804b6d72-cf9f-4827-9545-1aa126f59573','4e73d913-8bf4-4c9b-ae92-f76f3ac28055','b674132c-b68f-4920-9b25-977527e39eb9','a503218f-0d0a-4393-a771-a6ddf8a02173','dfd30a1a-1b6c-463d-a433-2d03c486c616','f0f16293-d146-4bb1-a430-5547623a88d0','28e305ff-4e54-404c-b360-21336eb0508e','a41079be-81eb-4874-949d-d6636974dae8','c3f9b8fd-58fe-4a38-a8c5-68aabf81f489','38a37a50-a9f4-44f3-b233-376345b4d3d7','bb54e3f4-30f1-4069-8aec-c5fe238a1359','832b75bc-1555-444c-8354-f3c1b5aba4df'];
const rows=await q(`SELECT id, clinic_id, close_date, pay_time, chart_number, customer_name, lead_source, visit_type, staff_name, amount, method, memo, created_at FROM closing_manual_payments WHERE id IN (${IDS.map(i=>`'${i}'`).join(',')}) ORDER BY created_at;`);
console.log(JSON.stringify(rows,null,2));
console.log('COUNT:',rows.length,'SUM:',rows.reduce((s,r)=>s+Number(r.amount),0));
