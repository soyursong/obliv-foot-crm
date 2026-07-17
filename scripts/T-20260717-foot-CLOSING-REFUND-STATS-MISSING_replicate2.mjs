/**
 * REPLICATE 2 (READ-ONLY) — staff 테이블 정합 + 화면과 동일 담당자별 매출 재현.
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const start = new Date('2026-07-17T00:00:00+09:00').toISOString();
const end = new Date('2026-07-17T23:59:59.999+09:00').toISOString();
const fmtT = iso => { const d=new Date(iso); return d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'}); };

const { data: payments=[] } = await sb.from('payments')
  .select('id, amount, method, payment_type, created_at, customer_id, check_in_id, status, linked_payment_id')
  .eq('clinic_id', CLINIC).gte('created_at', start).lte('created_at', end).neq('status','deleted').order('created_at',{ascending:true});
const { data: pkgPayments=[] } = await sb.from('package_payments')
  .select('id, package_id, amount, method, payment_type, created_at, customer_id, parent_payment_id')
  .eq('clinic_id', CLINIC).gte('created_at', start).lte('created_at', end).order('created_at',{ascending:true});
// manual entries (closing_manual_payments for date)
const { data: manual=[] } = await sb.from('closing_manual_payments').select('*').eq('clinic_id', CLINIC).eq('close_date','2026-07-17');

const custIds = [...new Set([...payments.map(p=>p.customer_id), ...pkgPayments.map(p=>p.customer_id)].filter(Boolean))];
const { data: custs=[] } = await sb.from('customers').select('id, name, chart_number, assigned_staff_id').in('id', custIds);
const customerMap = new Map(custs.map(c=>[c.id,c]));
const { data: staff=[] } = await sb.from('staff').select('id, name');
const staffMap = new Map(staff.map(s=>[s.id, s.name]));

const rows=[];
for (const p of payments){ const c=customerMap.get(p.customer_id); rows.push({src:'payment',id:p.id,amount:p.amount,method:p.method,pt:p.payment_type,staff:c?.assigned_staff_id?(staffMap.get(c.assigned_staff_id)??null):null,name:c?.name??'-',chart:c?.chart_number,linked:p.linked_payment_id,t:p.created_at}); }
for (const p of pkgPayments){ const c=customerMap.get(p.customer_id); rows.push({src:'package',pkgid:p.id,amount:p.amount,method:p.method,pt:p.payment_type,staff:c?.assigned_staff_id?(staffMap.get(c.assigned_staff_id)??null):null,name:c?.name??'-',chart:c?.chart_number,parent:p.parent_payment_id,t:p.created_at}); }
for (const m of manual){ rows.push({src:'manual',amount:m.amount,method:m.method,pt:'payment',staff:m.staff_name,name:m.customer_name,chart:m.chart_number,t:m.created_at}); }

// merge refund -> original
const byPay=new Map(), byPkg=new Map();
for (const r of rows){ if(r.pt==='refund')continue; if(r.src==='payment'&&r.id)byPay.set(r.id,r); if(r.src==='package'&&r.pkgid)byPkg.set(r.pkgid,r);}
for (const r of rows){ if(r.pt!=='refund')continue; const o=r.src==='payment'&&r.linked?byPay.get(r.linked):r.src==='package'&&r.parent?byPkg.get(r.parent):null; if(!o){r.orphan=true;continue;} r.merged=true; o.refunded=true; o.refamt=(o.refamt??0)+r.amount; }

// 담당자별 매출 (staffTotals) — enrichedRows 전체(refund 포함) net
const map=new Map();
for (const r of rows){ const k=r.staff??'미지정'; const e=map.get(k)??{name:k,total:0,card:0,cash:0,transfer:0}; const a=r.pt==='refund'?-r.amount:r.amount; e.total+=a; if(r.method==='card'||r.method==='membership')e.card+=a; else if(r.method==='cash')e.cash+=a; else if(r.method==='transfer')e.transfer+=a; map.set(k,e);}
console.log('=== 담당자별 매출 (현재 재현) ===');
let gt=0,gc=0,gh=0,gtr=0;
for (const s of [...map.values()].sort((a,b)=>b.total-a.total)){ console.log(`  ${s.name.padEnd(6)} 카드 ${s.card.toLocaleString()} · 현금 ${s.cash.toLocaleString()} · 이체 ${s.transfer.toLocaleString()} · 합계 ${s.total.toLocaleString()}`); gt+=s.total;gc+=s.card;gh+=s.cash;gtr+=s.transfer;}
console.log(`  ─ 합계: 카드 ${gc.toLocaleString()} 현금 ${gh.toLocaleString()} 이체 ${gtr.toLocaleString()} 총 ${gt.toLocaleString()}`);

// 홍미옥 rows
console.log('\n=== 홍미옥(F-4840) 행 + refund 반영 ===');
for (const r of rows.filter(r=>r.name==='홍미옥')) console.log(`  [${fmtT(r.t)}] ${r.src} ${r.pt} ${r.amount.toLocaleString()} ${r.method} staff=${r.staff} merged=${r.merged??false} refunded=${r.refunded??false} refamt=${r.refamt??0} orphan=${r.orphan??false}`);
const hongStaff = customerMap.get('e2e1fa00-a788-437b-b936-8f2a4241d299')?.assigned_staff_id;
console.log(`  홍미옥 담당 staff = ${staffMap.get(hongStaff)} (${hongStaff})`);

// 리스트 표시행(merged 제외) 시간순
console.log('\n=== 표시 리스트(merged refund 제외) 시간순 — 홍미옥 부근 ===');
for (const r of rows.filter(r=>!r.merged).sort((a,b)=> (a.t<b.t?-1:1))) if(r.name==='홍미옥'||r.refunded) console.log(`  [${fmtT(r.t)}] ${r.chart} ${r.name} ${r.pt} ${r.amount.toLocaleString()} ${r.method} refunded=${r.refunded??false} refamt=${r.refamt??0}`);
console.log('\n=== DONE ===');
