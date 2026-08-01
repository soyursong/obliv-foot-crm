// T-20260801 F-4741 보강 READ-ONLY: 두 check-in의 전 서비스라인 + payment_items + seller staff명.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter((l)=>l&&!l.trimStart().startsWith('#')&&l.includes('=')).map((l)=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const won=(n)=>(n??0).toLocaleString('ko-KR')+'원';
const CI_0725='fdd5c165-8375-470e-9b9d-cad851de93a6', CI_0801='dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf';
async function main(){
  for (const [label, ci] of [['7/25(experience,payment_waiting)',CI_0725],['8/1(returning,done)',CI_0801]]) {
    console.log(`\n=== check-in ${label} ci=${ci} 전 서비스라인 ===`);
    const { data } = await sb.from('check_in_services').select('id, price, service_name, seller_staff_id, is_package_session, created_at').eq('check_in_id', ci);
    let sum=0; (data??[]).forEach((r)=>{ sum+=r.price??0; console.log(`  ${r.service_name} | ${won(r.price)} | pkg=${r.is_package_session??false} | cis=${r.id}`); });
    console.log(`  서비스라인 합계 = ${won(sum)}`);
  }
  // payment_items
  const { data: pays } = await sb.from('payments').select('id, amount, method').in('check_in_id',[CI_0725,CI_0801]);
  for (const p of pays??[]) {
    const { data: items } = await sb.from('payment_items').select('description, amount, category').eq('payment_id', p.id);
    console.log(`\n=== payment ${p.id} (${won(p.amount)} ${p.method}) items ${items?.length??0}건 ===`);
    (items??[]).forEach((it)=>console.log(`  ${it.description} | ${won(it.amount)} | cat=${it.category??'-'}`));
  }
  // seller staff명
  const { data: st } = await sb.from('staff').select('id,name,role').eq('id','3a0c6774-2bd9-4018-bb38-ef6fab75d04b');
  console.log(`\n=== seller staff ===`); (st??[]).forEach((s)=>console.log(`  ${s.name} | role=${s.role} | id=${s.id}`));
  console.log('\n__DONE2__');
}
main().catch((e)=>{console.error('ERR',e.message);process.exit(1);});
