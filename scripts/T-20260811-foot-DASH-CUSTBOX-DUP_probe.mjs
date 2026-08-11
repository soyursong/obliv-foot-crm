/**
 * T-20260811-foot-DASH-CUSTBOX-DUP-AUTOCREATE-F5465 — READ-ONLY 진단 (write 0)
 *   AC-2 분기 핵심: 강민구 #F-5465 기준 reservations/check_ins 중복행 실재 여부.
 *   render-중복 vs DB-중복행 판정. Management API /database/query. READ-ONLY.
 */
import fs from 'fs';
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local','utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/); if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g,'');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }
async function qj(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method:'POST', headers:{ Authorization:`Bearer ${TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ query: sql }) });
  const t = await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}
const p = (label, rows) => { console.log(`\n=== ${label} (${rows.length} rows) ===`); console.log(JSON.stringify(rows, null, 2)); };

try {
  // 1) 강민구 / F-5465 고객 식별
  const custs = await qj(`
    SELECT id, name, chart_number, designated_therapist_id, clinic_id, created_at
    FROM customers
    WHERE chart_number ILIKE '%5465%' OR name = '강민구'
    ORDER BY created_at`);
  p('customers (F-5465 / 강민구)', custs);
  if (!custs.length) { console.log('고객 미발견 — 종료'); process.exit(0); }

  const ids = custs.map(c => `'${c.id}'`).join(',');

  // 2) 오늘(2026-08-11) reservations 중복 여부
  const resv = await qj(`
    SELECT id, customer_id, reservation_date, reservation_time, status, visit_type, source_system, created_at
    FROM reservations
    WHERE customer_id IN (${ids}) AND reservation_date = '2026-08-11'
    ORDER BY reservation_time, created_at`);
  p('reservations 2026-08-11 (강민구)', resv);

  // 3) 오늘 check_ins 중복 여부
  const ci = await qj(`
    SELECT id, customer_id, reservation_id, visit_type, status, checked_in_at, created_at
    FROM check_ins
    WHERE customer_id IN (${ids})
      AND checked_in_at >= '2026-08-11T00:00:00+09:00'
      AND checked_in_at <  '2026-08-12T00:00:00+09:00'
    ORDER BY checked_in_at, created_at`);
  p('check_ins 2026-08-11 (강민구)', ci);

  // 4) 판정 요약
  console.log('\n=== 판정 ===');
  console.log(`customers rows: ${custs.length} (>1 = 고객 중복행)`);
  console.log(`reservations rows(오늘): ${resv.length}`);
  console.log(`check_ins rows(오늘): ${ci.length}`);
  const resvNoLink = resv.length; // 예약들
  const ciWithCust = ci.filter(x => x.customer_id && !x.reservation_id).length;
  console.log(`check_ins(customer_id有·reservation_id無): ${ciWithCust}`);
  console.log(`>> 렌더-중복 시나리오 조건(예약≥2 & customer_id폴백 ci≥1): ${resv.length >= 2 && ciWithCust >= 1}`);
} catch(e){ console.error('ERR', e.message); process.exit(1); }
