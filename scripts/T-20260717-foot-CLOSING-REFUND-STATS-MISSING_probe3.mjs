/**
 * PROBE 3 (READ-ONLY) — 350,000 환불 광역 추적
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const HONG = 'e2e1fa00-a788-437b-b936-8f2a4241d299';

// 1) 최근 14일 clinic 전체 refund 행 (payments + package_payments)
const since = new Date(`2026-07-04T00:00:00+09:00`).toISOString();
const { data: rSingle } = await sb.from('payments')
  .select('customer_id, amount, method, status, created_at, linked_payment_id, memo')
  .eq('clinic_id', CLINIC).eq('payment_type','refund').gte('created_at', since).order('created_at',{ascending:false});
console.log(`=== 최근14일 단건 refund 행 ${rSingle?.length??0}건 ===`);
for (const r of rSingle??[]) console.log(`  cust=${r.customer_id} amt=${r.amount} status=${r.status} created=${r.created_at} memo=${(r.memo||'').slice(0,30)}`);

const { data: rPkg } = await sb.from('package_payments')
  .select('customer_id, amount, method, status, created_at, parent_payment_id')
  .eq('clinic_id', CLINIC).eq('payment_type','refund').gte('created_at', since).order('created_at',{ascending:false});
console.log(`\n=== 최근14일 패키지 refund 행 ${rPkg?.length??0}건 ===`);
for (const r of rPkg??[]) console.log(`  cust=${r.customer_id} amt=${r.amount} status=${r.status??'n/a'} created=${r.created_at} parent=${r.parent_payment_id}`);

// 2) 홍미옥 packages
const { data: hpk } = await sb.from('packages')
  .select('id, customer_id, total_amount, status, created_at, package_name')
  .eq('clinic_id', CLINIC).eq('customer_id', HONG);
console.log(`\n=== 홍미옥 packages ${hpk?.length??0}건 ===`);
for (const p of hpk??[]) console.log('  '+JSON.stringify(p));

// 3) amount 350000 payments/pkg 전 clinic 무필터 최근 30일
const since30 = new Date(`2026-06-17T00:00:00+09:00`).toISOString();
const { data: a1 } = await sb.from('payments').select('clinic_id, customer_id, amount, payment_type, status, created_at').eq('amount',350000).gte('created_at',since30);
console.log(`\n=== (무clinic필터) payments amount=350000 최근30일 ${a1?.length??0}건 ===`);
for (const p of a1??[]) console.log('  '+JSON.stringify(p));
const { data: a2 } = await sb.from('package_payments').select('clinic_id, customer_id, amount, payment_type, status, created_at').eq('amount',350000).gte('created_at',since30);
console.log(`=== (무clinic필터) package_payments amount=350000 최근30일 ${a2?.length??0}건 ===`);
for (const p of a2??[]) console.log('  '+JSON.stringify(p));

// 4) 홍미옥 이름/차트 memo 참조 (payments)
const { data: memoRef } = await sb.from('payments')
  .select('customer_id, amount, payment_type, status, created_at, memo')
  .eq('clinic_id', CLINIC).ilike('memo','%홍미옥%').order('created_at',{ascending:false}).limit(20);
console.log(`\n=== memo에 '홍미옥' 포함 payments ${memoRef?.length??0}건 ===`);
for (const p of memoRef??[]) console.log(`  cust=${p.customer_id} amt=${p.amount} [${p.payment_type}/${p.status}] created=${p.created_at} memo=${p.memo}`);

// 5) payments status 컬럼이 가질 수 있는 값 — 최근 clinic 전체 분포
const { data: statAll } = await sb.from('payments').select('status, payment_type').eq('clinic_id', CLINIC).gte('created_at', since);
const d={}; for(const p of statAll??[]){const k=`${p.payment_type}/${p.status}`; d[k]=(d[k]||0)+1;}
console.log(`\n=== 최근14일 clinic payments status/type 분포 ===`); console.log('  '+JSON.stringify(d));
console.log('\n=== PROBE3 DONE ===');
