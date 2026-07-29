// refix-2 검증 — 새 배선(RPC birth + package_sessions + check_in_services 방문스코프)이
// 실제 prod 큐 행에 값을 채우는지 시뮬레이션(read-only). service_role.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const SESSION_TYPE_KO = { heated_laser:'가열', unheated_laser:'비가열', podologue:'포돌로게', iv:'수액', preconditioning:'프컨', trial:'체험권', reborn:'리본', 'Re:Born':'리본' };
const sessionTypeLabel = (t) => { const v = String(t ?? '').trim(); return v ? (SESSION_TYPE_KO[v] ?? v) : ''; };
function birthYearAgeDisplay(bd) {
  if (!bd) return ''; const d = String(bd).replace(/\D/g,''); if (d.length<6) return '';
  const now=new Date(); let by,mm,dd;
  if (d.length===8){by=Number(d.slice(0,4));mm=Number(d.slice(4,6));dd=Number(d.slice(6,8)); if(by<1850||by>now.getFullYear())return '';}
  else {const yy=Number(d.slice(0,2));mm=Number(d.slice(2,4));dd=Number(d.slice(4,6));const c=yy<=now.getFullYear()%100?2000:1900;by=c+yy;}
  if(mm<1||mm>12||dd<1||dd>31)return ''; let age=now.getFullYear()-by; const cm=now.getMonth()+1,cd=now.getDate();
  if(cm<mm||(cm===mm&&cd<dd))age--; if(age<0||age>130)return String(by); return `${by} (만 ${age}세)`;
}

// queue rows
const { data: subs } = await sb.from('form_submissions').select('customer_id, check_in_id, field_data, status').limit(1000);
const sc = (subs ?? []).filter((r) => (r.field_data ?? {}).request_origin === 'staff_consult');
const rows = sc.filter(r => r.status==='draft' || (r.status==='voided' && (r.field_data??{}).resolved_reason==='published'))
  .map(r => ({ name:(r.field_data??{}).patient_name, customerId:r.customer_id, checkInId:r.check_in_id, status:r.status }));
const custIds = [...new Set(rows.map(r=>r.customerId).filter(Boolean))];
const ciIds = [...new Set(rows.map(r=>r.checkInId).filter(Boolean))];

// AC-1 birth via RPC
const birth = {};
for (let i=0;i<custIds.length;i+=100){ const {data}=await sb.rpc('fn_customer_birthdates',{p_clinic_id:CLINIC,p_ids:custIds.slice(i,i+100)}); for(const r of (data??[])) if(r.birth_date_display) birth[r.customer_id]=r.birth_date_display; }

// AC-2 package_sessions
const proc = {}; for(const c of ciIds) proc[c]=[];
{ const {data}=await sb.from('package_sessions').select('check_in_id, session_type, status, deleted_at').in('check_in_id',ciIds).eq('status','used').is('deleted_at',null);
  for(const p of (data??[])){ const lb=sessionTypeLabel(p.session_type); if(lb && proc[p.check_in_id]) proc[p.check_in_id].push(lb); } }

// AC-3 check_in_services 처방약
const rx = {}; for(const c of ciIds) rx[c]=[];
{ const {data}=await sb.from('check_in_services').select('check_in_id, service_name, services:service_id(category_label)').in('check_in_id',ciIds);
  for(const s of (data??[])){ const so=Array.isArray(s.services)?s.services[0]:s.services; if((so?.category_label)!=='처방약')continue; const nm=String(s.service_name??'').trim(); if(nm && rx[s.check_in_id]) rx[s.check_in_id].push(nm); } }

// render
let a1=0,a2=0,a3=0;
console.log('name | 생년(만나이) | 오늘시술 | 처방내역 | status');
for (const r of rows.slice(0,40)) {
  const b = birthYearAgeDisplay((r.customerId?birth[r.customerId]:'')||'') || '—';
  const p = (r.checkInId&&proc[r.checkInId]?.length)?proc[r.checkInId].join(', '):'—';
  const x = (r.checkInId&&rx[r.checkInId]?.length)?rx[r.checkInId].join(', '):'—';
  if(b!=='—')a1++; if(p!=='—')a2++; if(x!=='—')a3++;
  console.log(`${r.name} | ${b} | ${p} | ${x} | ${r.status}`);
}
// full-set counts
let A1=0,A2=0,A3=0;
for (const r of rows){ if((birthYearAgeDisplay((r.customerId?birth[r.customerId]:'')||'')||'—')!=='—')A1++; if(r.checkInId&&proc[r.checkInId]?.length)A2++; if(r.checkInId&&rx[r.checkInId]?.length)A3++; }
console.log(`\n[COVERAGE over ${rows.length} rows] AC-1 birth=${A1} AC-2 proc=${A2} AC-3 rx=${A3}`);
console.log('[DONE VERIFY]');
