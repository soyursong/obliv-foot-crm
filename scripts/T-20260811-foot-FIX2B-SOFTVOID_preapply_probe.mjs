/**
 * T-20260811-foot-CONSULTANT-REVENUE-FIX2B-SOFTVOID — PRE-APPLY READ-ONLY probe
 *   GO-token 제약: apply 前 prod 상태가 supervisor probe ground-truth 와 1건이라도 다르면 STOP·재-CONSULT.
 *   검증: (A) 대상 3행 active/cancelled_by NULL + fingerprint 완전일치
 *         (B) phantom 3행 이미 cancelled by MATAEMIN-ROLLBACK
 *         (C) blast-radius: fingerprint 술어 매칭셋 == 정확히 3행 (stray 0)
 *         (D) v_daily_revenue 08-04 single_revenue == 3,580,600 (before)
 *   write 0. Management API `/database/query` (ref rxlomoozakkjesdqjtvd).
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const TARGETS = ['2dedc31e-109d-46c6-b592-afe25b8d46b0','1799c939-a810-481d-ae41-1d50937e180b','ea1f5000-b48c-4ddd-9faa-23925a27d40f'];
const PHANTOMS = ['d05b5a95-4de3-4f71-a018-932e1ef11adf','4385ba22-be39-48f4-9386-ddcc7086c22a','9d8c6f77-dbe0-40c1-a024-5b33b23fb035'];
const CUSTOMER = 'c18b7fd4-1183-4fa1-8aa3-442a65ee24d2';
const CHECKIN = '3c69ac66-63e3-451d-ae42-33a8ef88a1b3';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MATAEMIN_BY = 'dev-foot:T-20260804-MATAEMIN-ROLLBACK';
const EXPECT_LINK = {
  '2dedc31e-109d-46c6-b592-afe25b8d46b0':'d05b5a95-4de3-4f71-a018-932e1ef11adf',
  '1799c939-a810-481d-ae41-1d50937e180b':'4385ba22-be39-48f4-9386-ddcc7086c22a',
  'ea1f5000-b48c-4ddd-9faa-23925a27d40f':'9d8c6f77-dbe0-40c1-a024-5b33b23fb035',
};
const EXPECT_AMT = {
  '2dedc31e-109d-46c6-b592-afe25b8d46b0':3100,
  '1799c939-a810-481d-ae41-1d50937e180b':5600,
  'ea1f5000-b48c-4ddd-9faa-23925a27d40f':261700,
};

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
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}
const arr = a => `ARRAY[${a.map(x=>`'${x}'`).join(',')}]::uuid[]`;

const ev = { ticket:'T-20260811-foot-CONSULTANT-REVENUE-FIX2B-SOFTVOID', phase:'pre-apply-probe', ref:REF, ts:new Date().toISOString(), checks:{} };
let ok = true;
const fail = (k,msg)=>{ ok=false; console.log(`❌ ${k}: ${msg}`); };
const pass = (k,msg)=>{ console.log(`✅ ${k}: ${msg}`); };

try {
  console.log(`── Management API 연결(${REF}) READ-ONLY ──\n`);

  // (A) 대상 3행
  const t = await qj(`SELECT id::text, status, payment_type, memo, customer_id::text, check_in_id::text,
      clinic_id::text, amount, linked_payment_id::text, service_charge_id::text,
      cancelled_by, cancelled_at::text, cancel_reason, is_simulation
    FROM public.payments WHERE id = ANY(${arr(TARGETS)}) ORDER BY amount`);
  ev.checks.targets = t;
  if (t.length !== 3) fail('A-count', `대상행 ${t.length}개 (기대 3)`);
  else {
    let allgood = true;
    for (const row of t) {
      const errs = [];
      if (row.status !== 'active') errs.push(`status=${row.status}`);
      if (row.cancelled_by !== null) errs.push(`cancelled_by=${row.cancelled_by}`);
      if (row.cancelled_at !== null) errs.push(`cancelled_at=${row.cancelled_at}`);
      if (row.cancel_reason !== null) errs.push(`cancel_reason set`);
      if (row.payment_type !== 'refund') errs.push(`payment_type=${row.payment_type}`);
      if (row.memo !== 'crm오류') errs.push(`memo=${row.memo}`);
      if (row.customer_id !== CUSTOMER) errs.push(`customer_id=${row.customer_id}`);
      if (row.check_in_id !== CHECKIN) errs.push(`check_in_id=${row.check_in_id}`);
      if (row.clinic_id !== CLINIC) errs.push(`clinic_id=${row.clinic_id}`);
      if (row.service_charge_id !== null) errs.push(`service_charge_id=${row.service_charge_id} (SSOT firewall!)`);
      if (row.linked_payment_id !== EXPECT_LINK[row.id]) errs.push(`linked=${row.linked_payment_id}`);
      if (Number(row.amount) !== EXPECT_AMT[row.id]) errs.push(`amount=${row.amount}`);
      if (errs.length) { allgood=false; fail(`A-row ${row.id.slice(0,8)}`, errs.join('; ')); }
    }
    if (allgood) pass('A-targets', `3행 전부 active·cancelled_by NULL·fingerprint 일치·service_charge_id NULL(SSOT firewall)·sum=${t.reduce((s,r)=>s+Number(r.amount),0)}`);
  }

  // (B) phantom 3행
  const p = await qj(`SELECT id::text, status, cancelled_by, payment_type, amount
    FROM public.payments WHERE id = ANY(${arr(PHANTOMS)}) ORDER BY amount`);
  ev.checks.phantoms = p;
  if (p.length !== 3) fail('B-count', `phantom ${p.length}개 (기대 3)`);
  else {
    let allgood = true;
    for (const row of p) {
      const errs = [];
      if (row.status !== 'cancelled') errs.push(`status=${row.status}`);
      if (row.cancelled_by !== MATAEMIN_BY) errs.push(`cancelled_by=${row.cancelled_by}`);
      if (errs.length) { allgood=false; fail(`B-phantom ${row.id.slice(0,8)}`, errs.join('; ')); }
    }
    if (allgood) pass('B-phantoms', `3행 전부 cancelled by MATAEMIN-ROLLBACK (무접촉 대상)`);
  }

  // (C) blast-radius: fingerprint 술어 매칭셋 == 정확히 3행
  const br = await qj(`SELECT id::text FROM public.payments
    WHERE customer_id='${CUSTOMER}' AND payment_type='refund' AND memo='crm오류'
      AND status='active' AND check_in_id='${CHECKIN}'
      AND linked_payment_id = ANY(${arr(PHANTOMS)})`);
  ev.checks.blast_radius = { matched_ids: br.map(x=>x.id), count: br.length };
  const brSet = new Set(br.map(x=>x.id));
  const exactMatch = br.length===3 && TARGETS.every(id=>brSet.has(id));
  if (!exactMatch) fail('C-blast', `fingerprint 매칭 ${br.length}행: ${br.map(x=>x.id).join(',')} (기대 정확히 3 대상)`);
  else pass('C-blast', `fingerprint 술어 매칭셋 = 정확히 3 대상행 (stray 0)`);

  // (D) v_daily_revenue 08-04 single_revenue baseline
  const v = await qj(`SELECT single_revenue, package_revenue, net_revenue
    FROM public.v_daily_revenue WHERE dt='2026-08-04' AND clinic_id='${CLINIC}'`);
  ev.checks.v_daily_revenue_before = v;
  if (v.length !== 1) fail('D-vrev', `08-04 row ${v.length}개`);
  else if (Number(v[0].single_revenue) !== 3580600) fail('D-vrev', `single_revenue=${v[0].single_revenue} (기대 3,580,600)`);
  else pass('D-vrev', `08-04 single=${v[0].single_revenue} package=${v[0].package_revenue} net=${v[0].net_revenue} (baseline 일치)`);

} catch (e) {
  ok = false;
  console.error(`\n❌ probe 예외: ${e.message}`);
  ev.error = e.message;
}

ev.verdict = ok ? 'MATCH — apply 진행 가능' : 'MISMATCH — STOP·재-CONSULT';
fs.writeFileSync('scripts/T-20260811-foot-FIX2B-SOFTVOID_preapply_probe.out.json', JSON.stringify(ev,null,2));
console.log(`\n${ok?'✅ GROUND-TRUTH MATCH — apply 진행 가능':'🛑 MISMATCH — STOP·재-CONSULT'}`);
console.log(`   evidence → scripts/T-20260811-foot-FIX2B-SOFTVOID_preapply_probe.out.json`);
process.exit(ok?0:2);
