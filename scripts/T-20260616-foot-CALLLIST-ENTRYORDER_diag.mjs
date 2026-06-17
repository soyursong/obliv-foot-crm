/**
 * T-20260616-foot-CALLLIST-ENTRYORDER-FALLBACK-RECEIPTLEAK — AC-4 진단 (READ-ONLY)
 * 진료콜 명단(active) 환자의 실제 정렬 근거 데이터를 캡처해 회귀 근본원인 규명.
 *   - 가설1: callEntryTime 방향(asc) — 먼저 진입=top 이 데이터상 맞는지
 *   - 가설2: call_list_manual_order 잔존/비-NULL 오염
 *   - 가설3: 상태별 분류(healer_waiting/purple/yellow), tier 폴백 단계 분포
 * 어떤 write 도 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 오늘(Asia/Seoul) 범위
const now = new Date();
const kst = new Date(now.getTime() + 9 * 3600 * 1000);
const dateStr = kst.toISOString().slice(0, 10);
const start = `${dateStr}T00:00:00+09:00`;
const end = `${dateStr}T23:59:59+09:00`;
console.log('=== 진단 날짜(KST):', dateStr, '===\n');

// 활성 진료콜 명단 후보: status_flag in (purple,yellow) OR status=healer_waiting, 오늘 접수
const { data: cis, error } = await sb.from('check_ins')
  .select('id, clinic_id, customer_name, visit_type, status, status_flag, status_flag_history, call_list_manual_order, checked_in_at, doctor_status')
  .gte('checked_in_at', start).lte('checked_in_at', end);
if (error) { console.error('check_ins err', error); process.exit(1); }

const active = (cis ?? []).filter(c => c.status_flag === 'purple' || c.status_flag === 'yellow' || c.status === 'healer_waiting');
console.log(`오늘 접수 ${cis?.length}건 / 진료콜 active ${active.length}건\n`);

// status_transitions (callEntryMap 재현)
const { data: trans } = await sb.from('status_transitions')
  .select('check_in_id, to_status, transitioned_at')
  .gte('transitioned_at', start).lte('transitioned_at', end)
  .order('transitioned_at', { ascending: false });
const callEntry = new Map();
for (const t of trans ?? []) {
  if (!callEntry.has(t.check_in_id) && ['healer_waiting','purple','yellow'].includes(t.to_status)) {
    callEntry.set(t.check_in_id, t.transitioned_at);
  }
}

// callEntryTime 재현 (코드 로직 동일)
function callEntryTime(ci) {
  const hist = ci.status_flag_history;
  if (Array.isArray(hist) && hist.length > 0) {
    let episodeStart = null;
    for (let i = hist.length - 1; i >= 0; i--) {
      const e = hist[i];
      if (e && (e.flag === 'purple' || e.flag === 'yellow') && e.changed_at) episodeStart = e.changed_at;
      else break;
    }
    if (episodeStart) return { t: episodeStart, tier: '①flagHist(episodeStart)' };
  }
  if (callEntry.has(ci.id)) return { t: callEntry.get(ci.id), tier: '②transition' };
  return { t: ci.checked_in_at, tier: '③checked_in_at' };
}

const rows = active.map(c => {
  const et = callEntryTime(c);
  const histLen = Array.isArray(c.status_flag_history) ? c.status_flag_history.length : 0;
  const histFlags = Array.isArray(c.status_flag_history) ? c.status_flag_history.map(h => `${h.flag}@${h.changed_at?.slice(11,19)}`).join(',') : '';
  return {
    name: c.customer_name, status: c.status, flag: c.status_flag,
    manual: c.call_list_manual_order, checkin: c.checked_in_at?.slice(11,19),
    entryTier: et.tier, entryTime: et.t?.slice(11,19),
    histLen, histFlags,
  };
});

// 실제 정렬자 재현 (compareCallOrder tier1~3)
function isInTreatment(c){ return c.status==='examination' || c.doctor_status==='in_treatment'; }
const sorted = [...active].sort((a,b)=>{
  const at=isInTreatment(a)?0:1, bt=isInTreatment(b)?0:1; if(at!==bt) return at-bt;
  const am=typeof a.call_list_manual_order==='number'?a.call_list_manual_order:null;
  const bm=typeof b.call_list_manual_order==='number'?b.call_list_manual_order:null;
  if(am!==null&&bm!==null){ if(am!==bm) return am-bm; } else if(am!==null||bm!==null){ return am!==null?-1:1; }
  return callEntryTime(a).t.localeCompare(callEntryTime(b).t);
});

console.log('=== 정렬 결과 (위→아래 = 명단 표시순) ===');
sorted.forEach((c,i)=>{
  const et=callEntryTime(c);
  console.log(`${i+1}. ${c.customer_name} | flag=${c.status_flag} status=${c.status} | manual=${c.call_list_manual_order} | 접수=${c.checked_in_at?.slice(11,19)} | 진입=${et.t?.slice(11,19)}[${et.tier}]`);
});

console.log('\n=== tier 폴백 분포 ===');
const tierCount={}; rows.forEach(r=>{tierCount[r.entryTier]=(tierCount[r.entryTier]||0)+1;});
console.log(tierCount);
const manualNonNull = active.filter(c=>typeof c.call_list_manual_order==='number');
console.log(`call_list_manual_order 비-NULL: ${manualNonNull.length}건`, manualNonNull.map(c=>`${c.customer_name}=${c.call_list_manual_order}`));

console.log('\n=== status_flag_history 상세(진입시각 산출 근거) ===');
rows.forEach(r=>console.log(`${r.name}: histLen=${r.histLen} [${r.histFlags}] → entry=${r.entryTime}(${r.entryTier}), 접수=${r.checkin}`));
