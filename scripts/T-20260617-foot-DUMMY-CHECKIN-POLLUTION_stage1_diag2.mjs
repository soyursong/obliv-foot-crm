/**
 * Stage1 diag2 — 더미 마커가 is_simulation 에 안 잡히는 케이스까지 넓게 실측 (READ-ONLY)
 * 오늘 30건 더미의 실제 생성 흔적(memo/날짜/check_ins created_at)을 마커 무관 추적.
 */
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
function kst(ts){ return ts ? new Date(new Date(ts).getTime()+9*3600*1000).toISOString().slice(0,10) : null; }
function kstT(ts){ return ts ? new Date(new Date(ts).getTime()+9*3600*1000).toISOString().slice(0,16).replace('T',' ') : null; }

async function main(){
  // 1) 오늘 + 내일 예약 전체 (memo/is_simulation/status)
  for (const d of ['2026-06-16','2026-06-17','2026-06-18']) {
    const { data: r } = await sb.from('reservations')
      .select('id, customer_id, customer_name, visit_type, status, reservation_time, memo, created_at')
      .eq('clinic_id', CLINIC).eq('reservation_date', d).order('reservation_time');
    const ids = (r??[]).map(x=>x.customer_id).filter(Boolean);
    let simMap = new Map();
    for (let i=0;i<ids.length;i+=200){
      const { data: cs } = await sb.from('customers').select('id,is_simulation').in('id', ids.slice(i,i+200));
      (cs??[]).forEach(c=>simMap.set(c.id,c.is_simulation));
    }
    console.log(`\n=== 예약 ${d} : ${r?.length??0}건 ===`);
    for (const x of (r??[])) {
      console.log(`  ${x.reservation_time} ${x.customer_name} vt=${x.visit_type} st=${x.status} sim=${simMap.get(x.customer_id)??'?'} memo="${(x.memo||'').slice(0,30)}" created=${kstT(x.created_at)}`);
    }
  }

  // 2) 오늘 생성/체크인된 check_ins 전체 (더미마커 무관)
  console.log(`\n=== check_ins: created_at 오늘(2026-06-17) ===`);
  const { data: ciToday } = await sb.from('check_ins')
    .select('id, customer_id, reservation_id, customer_name, visit_type, status, checked_in_at, completed_at, created_at, notes')
    .eq('clinic_id', CLINIC).gte('created_at','2026-06-16T15:00:00Z').lte('created_at','2026-06-17T15:00:00Z')
    .order('created_at');
  console.log(`  created_at 오늘(KST) check_ins ${ciToday?.length??0}건`);
  const cIds = [...new Set((ciToday??[]).map(c=>c.customer_id).filter(Boolean))];
  let simC = new Map();
  for (let i=0;i<cIds.length;i+=200){
    const { data: cs } = await sb.from('customers').select('id,is_simulation,name').in('id', cIds.slice(i,i+200));
    (cs??[]).forEach(c=>simC.set(c.id,c));
  }
  for (const c of (ciToday??[])) {
    const cu = simC.get(c.customer_id);
    console.log(`  CI=${c.id.slice(0,8)} ${c.customer_name||cu?.name} vt=${c.visit_type} st=${c.status} sim=${cu?.is_simulation??'?'} chkin=${kstT(c.checked_in_at)} resv=${c.reservation_id?c.reservation_id.slice(0,8):'NULL'} created=${kstT(c.created_at)} notes=${(c.notes||'').slice(0,40)}`);
  }

  // 3) check_ins: checked_in_at 오늘 (일마감/셀프접수 화면 기준일 가능성)
  console.log(`\n=== check_ins: checked_in_at 오늘(2026-06-17 KST) ===`);
  const { data: ciChk } = await sb.from('check_ins')
    .select('id, customer_id, reservation_id, customer_name, visit_type, status, checked_in_at, created_at, notes')
    .eq('clinic_id', CLINIC).gte('checked_in_at','2026-06-16T15:00:00Z').lte('checked_in_at','2026-06-17T15:00:00Z')
    .order('checked_in_at');
  console.log(`  checked_in_at 오늘(KST) check_ins ${ciChk?.length??0}건`);
  const cIds2 = [...new Set((ciChk??[]).map(c=>c.customer_id).filter(Boolean))];
  let simC2 = new Map();
  for (let i=0;i<cIds2.length;i+=200){
    const { data: cs } = await sb.from('customers').select('id,is_simulation,name').in('id', cIds2.slice(i,i+200));
    (cs??[]).forEach(c=>simC2.set(c.id,c));
  }
  for (const c of (ciChk??[])) {
    const cu = simC2.get(c.customer_id);
    console.log(`  CI=${c.id.slice(0,8)} ${c.customer_name||cu?.name} vt=${c.visit_type} st=${c.status} sim=${cu?.is_simulation??'?'} chkin=${kstT(c.checked_in_at)} resv=${c.reservation_id?c.reservation_id.slice(0,8):'NULL'} notes=${(c.notes||'').slice(0,40)}`);
  }
}
main().catch(e=>{console.error('실패:',e.message);process.exit(1);});
