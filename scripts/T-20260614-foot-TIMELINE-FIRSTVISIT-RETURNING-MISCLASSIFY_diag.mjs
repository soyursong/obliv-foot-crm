// READ-ONLY 진단 — AC-1 근본 시나리오(A/B/C) 확정용. SELECT만. prod=dev 단일 DB.
// 가설:
//  A: ci.visit_type='new' 인데 매칭 reservation.visit_type='returning' → 타임라인 routing(r.visit_type) → 재진
//  B: NewCheckInDialog handlePatientSelect 기존고객 선택 시 ci.visit_type='returning' 강제 (ci 자체가 returning)
//  C: 예약 자체가 returning 으로 생성
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const JONGNO = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// 최근 14일 범위로 검사 (스크린샷 시점 포함 가능하도록 넓게)
const since = new Date(Date.now() - 14 * 86400000).toISOString();
const sinceDate = since.slice(0, 10);

// ── 체크인 로드 ──
const { data: cis, error: ciErr } = await sb.from('check_ins')
  .select('id, customer_id, reservation_id, visit_type, checked_in_at, clinic_id, customers(name)')
  .eq('clinic_id', JONGNO).gte('checked_in_at', since).order('checked_in_at', { ascending: false });
if (ciErr) { console.log('check_ins err', ciErr.message); process.exit(1); }

// ── 예약 로드 (같은 기간) ──
const { data: resvs, error: rErr } = await sb.from('reservations')
  .select('id, customer_id, visit_type, status, reservation_date, reservation_time, customer_name')
  .eq('clinic_id', JONGNO).gte('reservation_date', sinceDate).neq('status', 'cancelled');
if (rErr) { console.log('reservations err', rErr.message); process.exit(1); }

const resvById = new Map(resvs.map((r) => [r.id, r]));
// customer_id 폴백 매칭 (Dashboard 로직 재현: reservation_id 우선 → customer_id 첫건)
const resvByCust = new Map();
for (const r of resvs) { if (r.customer_id && !resvByCust.has(r.customer_id)) resvByCust.set(r.customer_id, r); }

console.log(`=== 진단 범위: 종로, ${sinceDate}~ / 체크인 ${cis.length}건, 예약 ${resvs.length}건 ===\n`);

let scenA = 0, scenB = 0, walkinNew = 0, matchedConsistent = 0;
const scenAList = [], scenBList = [];

for (const ci of cis) {
  const nm = ci.customers?.name ?? '(no-name)';
  // Dashboard 매칭 로직 재현: reservation_id 우선 → customer_id 폴백
  const r = (ci.reservation_id && resvById.get(ci.reservation_id))
    ?? (ci.customer_id ? resvByCust.get(ci.customer_id) : undefined);
  if (!r) {
    // 워크인 (예약 미매칭) → routing은 ci.visit_type
    if (ci.visit_type === 'new') walkinNew++;
    continue;
  }
  // 매칭 체크인 → routing은 r.visit_type (현행)
  if (ci.visit_type === 'new' && r.visit_type === 'returning') {
    scenA++;
    scenAList.push(`  [A] ${nm} ci=${ci.checked_in_at.slice(0,16)} ci.vt=new / r.vt=returning (r.id=${r.id.slice(0,8)} ${r.reservation_date})`);
  } else if (ci.visit_type === 'returning') {
    // ci 자체가 returning — B(강제) 또는 정상재진 구분은 r.visit_type 으로
    if (r.visit_type === 'new') {
      scenB++;
      scenBList.push(`  [B?] ${nm} ci.vt=returning / r.vt=new — ci 강제 returning 의심`);
    } else { matchedConsistent++; }
  } else { matchedConsistent++; }
}

console.log(`A (ci=new & r=returning, routing이 재진으로 오분류): ${scenA}건`);
scenAList.slice(0, 15).forEach((s) => console.log(s));
console.log(`\nB (ci=returning & r=new, 체크인 강제 returning 의심): ${scenB}건`);
scenBList.slice(0, 15).forEach((s) => console.log(s));
console.log(`\n워크인 초진(ci=new, 예약없음): ${walkinNew}건`);
console.log(`매칭 일관(정상): ${matchedConsistent}건`);

// ── C 보강: 예약 visit_type 분포 ──
const rvt = {};
for (const r of resvs) rvt[r.visit_type] = (rvt[r.visit_type] ?? 0) + 1;
console.log(`\n예약 visit_type 분포:`, JSON.stringify(rvt));

console.log(`\n=== 결론 ===`);
console.log(`A=${scenA} B=${scenB}. A>0 이면 routing 불일치(Option A fix), B>0 이면 입력단 강제(NewCheckInDialog).`);
process.exit(0);
