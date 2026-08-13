/**
 * T-20260725-foot-HOLIDAY-INITFEE-ITEM-DEACTIVATE — READ-ONLY 진단
 * '공휴일 초진진찰료-의원'(24,490) 수동 항목 식별 + 정규 '초진진찰료-의원(기본)' 유지 대상 확인.
 * *** SELECT 만. 어떤 write 도 하지 않는다. ***
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(readFileSync(join(__dirname,'..','.env.local'),'utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const money = (n) => (n == null ? n : Number(n).toLocaleString());
const { data, error } = await sb.from('services')
  .select('id, clinic_id, name, category, category_label, price, active, is_insurance_covered, hira_code, hira_score, service_code')
  .or('name.ilike.%초진%,name.ilike.%진찰%,name.ilike.%공휴일%')
  .order('name', { ascending: true });
if (error) { console.error('QUERY ERROR', error); process.exit(1); }
console.log(`\n=== 진찰료/공휴일 관련 services (${data.length}건) ===`);
for (const r of data) {
  console.log(`[${r.active?'ACTIVE ':'inactive'}] id=${r.id} clinic=${r.clinic_id}\n   name="${r.name}" cat="${r.category}"/"${r.category_label}" svc_code=${r.service_code}\n   price=${money(r.price)} covered=${r.is_insurance_covered} hira_code=${r.hira_code} hira_score=${r.hira_score}\n`);
}
const target = data.filter(r=>r.name&&r.name.includes('공휴일')&&r.name.includes('초진진찰료')&&Number(r.price)===24490);
console.log(`\n=== 폐기 대상 후보 (공휴일 초진진찰료 & price=24490): ${target.length}건 ===`);
target.forEach(r=>console.log(`   → id=${r.id} name="${r.name}" price=${money(r.price)} active=${r.active} covered=${r.is_insurance_covered} hira_score=${r.hira_score}`));
const keep = data.filter(r=>r.is_insurance_covered===true&&r.hira_score!=null&&r.name&&r.name.includes('초진진찰료'));
console.log(`\n=== 유지 대상(정규 급여 초진진찰료, covered+hira_score): ${keep.length}건 ===`);
keep.forEach(r=>console.log(`   → id=${r.id} name="${r.name}" price=${money(r.price)} covered=${r.is_insurance_covered} hira_score=${r.hira_score} active=${r.active}`));
process.exit(0);
