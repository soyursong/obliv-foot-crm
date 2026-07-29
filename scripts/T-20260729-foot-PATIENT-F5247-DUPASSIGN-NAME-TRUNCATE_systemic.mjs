/** T-20260729-foot-PATIENT-F5247-DUPASSIGN-NAME-TRUNCATE — READ-ONLY systemic probe
 *  활성배정 ≥2 환자 카운트 + cancelled 잔여 유령 + customer_name 스냅샷 불일치 국소성. SELECT only. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const envTxt = readFileSync(join(__dirname,'..','.env.local'),'utf8');
const env={}; for(const l of envTxt.split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if(m) env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const monthStart = new Date(Date.now()+9*3600*1000).toISOString().slice(0,7)+'-01T00:00:00+09:00';

const { data: ci } = await sb.from('check_ins')
  .select('id, customer_id, customer_name, consultant_id, therapist_id, status')
  .gte('checked_in_at', monthStart).is('deleted_at', null);
console.log('당월 non-deleted check_ins:', ci.length);

const grp=(pred,field)=>{const m=new Map();for(const c of ci){if(!pred(c))continue;const id=c[field],k=c.customer_id;if(!id||!k)continue;if(!m.has(k))m.set(k,new Set());m.get(k).add(id);}return [...m.entries()].filter(([,s])=>s.size>=2);};
console.log('현행fix후 [환자→활성 consultant ≥2]:', grp(c=>c.status!=='cancelled',(0,'consultant_id'))?.length ?? grp(c=>c.status!=='cancelled','consultant_id').length);
console.log('  (raw)', grp(c=>c.status!=='cancelled','consultant_id').map(([k,s])=>({cust:k,n:s.size})));
console.log('fix전(cancelled 포함) 유령후보 [환자→consultant ≥2]:', grp(()=>true,'consultant_id').length, grp(()=>true,'consultant_id').map(([k,s])=>({cust:k,n:s.size})));

const { data: ghost } = await sb.from('check_ins')
  .select('customer_name, consultant_id, status').eq('status','cancelled')
  .is('deleted_at', null).not('consultant_id','is',null).gte('checked_in_at', monthStart);
console.log('cancelled + deleted_at NULL + consultant_id有 (금일배분 잔여 유령 위험):', ghost.length, ghost.map(g=>g.customer_name));

const custIds=[...new Set(ci.map(c=>c.customer_id).filter(Boolean))];
const nameMap=new Map();
for(let i=0;i<custIds.length;i+=200){const {data}=await sb.from('customers').select('id,name').in('id',custIds.slice(i,i+200));for(const c of data??[])nameMap.set(c.id,c.name);}
let mism=[]; for(const c of ci){const real=nameMap.get(c.customer_id); if(real&&c.customer_name&&real!==c.customer_name) mism.push({snap:c.customer_name,real});}
console.log('당월 customer_name 스냅샷 불일치:', mism.length, mism.slice(0,10));
