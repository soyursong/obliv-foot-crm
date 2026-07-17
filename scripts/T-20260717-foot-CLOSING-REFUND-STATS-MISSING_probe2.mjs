/**
 * T-20260717-foot-CLOSING-REFUND-STATS-MISSING — PROBE 2 (READ-ONLY)
 * 350,000 환불이 payments/package_payments refund행이 아니면 어디에 있나?
 * (a) 350000 금액 결제행(전 상태) (b) closing_manual_payments (c) 상태변경(void/deleted) (d) 홍미옥 관련 전건
 */
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (()=>{throw new Error('key')})());
const sb = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DAY = '2026-07-17';
const start = new Date(`${DAY}T00:00:00+09:00`).toISOString();
const end   = new Date(`${DAY}T23:59:59.999+09:00`).toISOString();
const HONG = 'e2e1fa00-a788-437b-b936-8f2a4241d299';

// (a) 350000 금액 payments 전 상태 (오늘 created 또는 오늘 수정)
const { data: p350 } = await sb.from('payments')
  .select('id, customer_id, amount, method, payment_type, status, created_at, updated_at, accounting_date, memo, linked_payment_id')
  .eq('clinic_id', CLINIC_ID).eq('amount', 350000).order('created_at',{ascending:false}).limit(20);
console.log(`=== payments amount=350000 (전 상태) ${p350?.length??0}건 ===`);
for (const p of p350??[]) console.log(`  cust=${p.customer_id} [${p.payment_type}] status=${p.status} created=${p.created_at} updated=${p.updated_at} acct=${p.accounting_date} memo=${(p.memo||'').slice(0,40)}`);

const { data: pk350 } = await sb.from('package_payments')
  .select('id, customer_id, amount, method, payment_type, status, created_at, parent_payment_id')
  .eq('clinic_id', CLINIC_ID).eq('amount', 350000).order('created_at',{ascending:false}).limit(20);
console.log(`\n=== package_payments amount=350000 (전 상태) ${pk350?.length??0}건 ===`);
for (const p of pk350??[]) console.log(`  cust=${p.customer_id} [${p.payment_type}] status=${p.status??'n/a'} created=${p.created_at} parent=${p.parent_payment_id}`);

// (b) closing_manual_payments 오늘
let cmp=null,cmpErr=null;
try {
  const r = await sb.from('closing_manual_payments').select('*').eq('clinic_id', CLINIC_ID).limit(50);
  cmp=r.data; cmpErr=r.error;
} catch(e){ cmpErr=e; }
if (cmpErr) console.log(`\n=== closing_manual_payments 조회 오류: ${cmpErr.message||cmpErr} ===`);
else {
  console.log(`\n=== closing_manual_payments (clinic, 최근) ${cmp?.length??0}건 ===`);
  for (const m of (cmp??[]).slice(0,20)) console.log('  '+JSON.stringify(m));
}

// (c) 오늘 status=deleted/voided 로 바뀐 payments (soft-void 추정)
const { data: voided } = await sb.from('payments')
  .select('id, customer_id, amount, method, payment_type, status, created_at, updated_at, memo')
  .eq('clinic_id', CLINIC_ID).neq('status','active')
  .gte('updated_at', start).lte('updated_at', end).order('updated_at',{ascending:false}).limit(30);
console.log(`\n=== 오늘(updated_at) status!=active payments ${voided?.length??0}건 (soft-void 추정) ===`);
for (const p of voided??[]) console.log(`  cust=${p.customer_id} amt=${p.amount} [${p.payment_type}] status=${p.status} created=${p.created_at} updated=${p.updated_at} memo=${(p.memo||'').slice(0,40)}`);

// (d) 홍미옥 관련 전건: check_ins, reservations 등에서 350000 흔적
const { data: hcins } = await sb.from('check_ins')
  .select('id, customer_id, created_at, status, package_id')
  .eq('clinic_id', CLINIC_ID).eq('customer_id', HONG).order('created_at',{ascending:false}).limit(10);
console.log(`\n=== 홍미옥 check_ins ${hcins?.length??0}건 ===`);
for (const c of hcins??[]) console.log(`  cin=${c.id} status=${c.status} created=${c.created_at} pkg=${c.package_id}`);

// (e) payments 테이블 컬럼 확인 (status enum 값 분포 오늘)
const { data: allToday } = await sb.from('payments')
  .select('id, amount, payment_type, status, method, customer_id, created_at, memo')
  .eq('clinic_id', CLINIC_ID).gte('created_at', start).lte('created_at', end).order('created_at',{ascending:true});
console.log(`\n=== 오늘 created payments 전체 ${allToday?.length??0}건 (status/type 분포) ===`);
const dist={};
for (const p of allToday??[]) { const k=`${p.payment_type}/${p.status}`; dist[k]=(dist[k]||0)+1; }
console.log('  분포:', JSON.stringify(dist));
for (const p of allToday??[]) console.log(`  amt=${p.amount} [${p.payment_type}/${p.status}] ${p.method} cust=${p.customer_id} memo=${(p.memo||'').slice(0,30)}`);
console.log('\n=== PROBE2 DONE ===');
