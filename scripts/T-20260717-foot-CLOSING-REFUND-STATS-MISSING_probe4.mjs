/**
 * PROBE 4 (READ-ONLY) — 홍미옥 package(5ac32b4a) 350,000 lifecycle 추적
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const PKG = '5ac32b4a-2408-4475-87b2-2f8350292abf';

// 1) 이 package_id의 모든 package_payments (customer 무관, status 무관)
const { data: pp } = await sb.from('package_payments').select('*').eq('package_id', PKG).order('created_at',{ascending:true});
console.log(`=== package_id=${PKG} package_payments ${pp?.length??0}건 ===`);
for (const p of pp??[]) console.log('  '+JSON.stringify(p));

// 2) 패키지 전체 컬럼
const { data: pkg } = await sb.from('packages').select('*').eq('id', PKG).single();
console.log(`\n=== packages row 전체 ===`); console.log('  '+JSON.stringify(pkg));

// 3) package_sessions
let ps=null; try { const r=await sb.from('package_sessions').select('*').eq('package_id',PKG); ps=r.data; if(r.error) console.log('  sessions err:',r.error.message);}catch(e){console.log('sessions err',e.message);}
console.log(`\n=== package_sessions ${ps?.length??0}건 ===`);
for (const s of ps??[]) console.log('  '+JSON.stringify(s));

// 4) 오늘 clinic 전체 package_payments (전 상태) — 350000 흔적 + 삭제행 포함
const start = new Date('2026-07-17T00:00:00+09:00').toISOString();
const end = new Date('2026-07-17T23:59:59.999+09:00').toISOString();
const { data: todaypp } = await sb.from('package_payments').select('id, package_id, customer_id, amount, payment_type, method, status, created_at, parent_payment_id').eq('clinic_id',CLINIC).gte('created_at',start).lte('created_at',end).order('created_at',{ascending:true});
console.log(`\n=== 오늘 created package_payments 전체 ${todaypp?.length??0}건 ===`);
for (const p of todaypp??[]) console.log(`  pkg=${p.package_id?.slice(0,8)} cust=${p.customer_id?.slice(0,8)} amt=${p.amount} [${p.payment_type}/${p.status??'n/a'}] created=${p.created_at}`);

// 5) package_payments 테이블에 status 컬럼 있나 확인 위해 임의 1행
const { data: onepp } = await sb.from('package_payments').select('*').eq('clinic_id',CLINIC).limit(1);
console.log(`\n=== package_payments 컬럼 샘플 ===`);
console.log('  columns:', onepp && onepp[0] ? Object.keys(onepp[0]).join(', ') : 'none');

// 6) 오늘 clinic 전체 packages 생성 (350000 등)
const { data: todaypkg } = await sb.from('packages').select('id, customer_id, total_amount, status, package_name, created_at').eq('clinic_id',CLINIC).gte('created_at',start).lte('created_at',end);
console.log(`\n=== 오늘 created packages ${todaypkg?.length??0}건 ===`);
for (const p of todaypkg??[]) console.log(`  id=${p.id.slice(0,8)} cust=${p.customer_id?.slice(0,8)} total=${p.total_amount} status=${p.status} name=${p.package_name}`);
console.log('\n=== PROBE4 DONE ===');
