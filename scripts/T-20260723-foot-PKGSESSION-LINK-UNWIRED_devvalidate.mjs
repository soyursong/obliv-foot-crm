/**
 * T-20260723-foot-PKGSESSION-LINK-UNWIRED — dev-isolation apply + widened 불변식 실증(green).
 * prod(rxlomoo)는 supervisor 배포-前 게이트가 apply. 본 스크립트는 개발 DB(kcdqtyivtqcjmcrdjkqi)에
 * 마이그를 apply 하고 6 시나리오(완납/C1결정성/부분납shortfall/멱등/C3재저장/NULL폴백)를 검증한다.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const e = readFileSync('.env.dev-isolation.local', 'utf8');
const g = (k) => (e.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const URL = g('DEV_SUPABASE_URL');
const KEY = g('DEV_SUPABASE_SERVICE_ROLE_KEY');
const REF = g('DEV_SUPABASE_PROJECT_REF');
const MGMT = (readFileSync('.env.local', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const CLINIC = '4478bdb0-54cd-4b04-b506-7d023ecbcdba'; // 종로 풋센터(DEV)
const sb = createClient(URL, KEY);

async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${MGMT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.error('  ✗ FAIL:', m); } };
const created = { customers: [], packages: [], checkIns: [], services: [] };
let seq = 0;
const uniq = () => `${Date.now()}${(seq++).toString().padStart(3, '0')}`.slice(-9);

async function mkCustomer() {
  const t = uniq();
  const { data, error } = await sb.from('customers').insert({ clinic_id: CLINIC, name: `qa-${t}`, phone: `+8210${t.slice(-8)}`, visit_type: 'new', memo: '[QA-DEV]' }).select('id').single();
  if (error) throw new Error('customer: ' + error.message);
  created.customers.push(data.id); return data.id;
}
async function mkPackage(cust, heated, unheated) {
  const { data, error } = await sb.from('packages').insert({ clinic_id: CLINIC, customer_id: cust, package_name: 'qa', package_type: 'p', total_sessions: heated + unheated, heated_sessions: heated, unheated_sessions: unheated, total_amount: 100, paid_amount: 100, status: 'active', memo: '[QA-DEV]' }).select('id').single();
  if (error) throw new Error('pkg: ' + error.message);
  created.packages.push(data.id); return data.id;
}
async function mkService() {
  const { data, error } = await sb.from('services').insert({ clinic_id: CLINIC, name: `qa-${uniq()}`, category: '비가열레이저', price: 100000 }).select('id').single();
  if (error) throw new Error('svc: ' + error.message);
  created.services.push(data.id); return data.id;
}
async function mkCheckIn(cust) {
  const t = uniq();
  const { data, error } = await sb.from('check_ins').insert({ clinic_id: CLINIC, customer_id: cust, customer_name: 'qa', customer_phone: `+8210${t.slice(-8)}`, visit_type: 'new', status: 'registered', queue_number: 900000 + (seq++ % 90000), checked_in_at: new Date().toISOString(), notes: '[QA-DEV]' }).select('id').single();
  if (error) throw new Error('checkin: ' + error.message);
  created.checkIns.push(data.id); return data.id;
}
async function mkCIS(ci, svc) {
  const { data, error } = await sb.from('check_in_services').insert({ check_in_id: ci, service_id: svc, service_name: 'u', price: 100000, original_price: 100000, is_package_session: false }).select('id').single();
  if (error) throw new Error('cis: ' + error.message);
  return data.id;
}
const cis = async (ci) => (await sb.from('check_in_services').select('id, service_id, package_session_id, is_package_session').eq('check_in_id', ci)).data ?? [];
const ps = async (ci) => (await sb.from('package_sessions').select('id').eq('check_in_id', ci)).data ?? [];

(async () => {
  // ── apply migration to DEV ──
  const mig = readFileSync('supabase/migrations/20260723190000_foot_pkgsession_link_unwired_widened.sql', 'utf8');
  console.log('=== apply widened migration → DEV', REF, '===');
  await mgmt(mig);
  const sig = await mgmt(`SELECT p.oid::regprocedure::text sig FROM pg_proc p WHERE p.proname='consume_package_sessions_for_checkin' ORDER BY 1`);
  console.log('sig after apply:', JSON.stringify(sig.map((r) => r.sig)));
  ok(sig.length === 1 && sig[0].sig.includes('jsonb,jsonb)'), '단일 5-arg 시그니처(오버로드 없음)');

  const call = (ci, cust, counts, ss) => sb.rpc('consume_package_sessions_for_checkin', { p_check_in_id: ci, p_customer_id: cust, p_clinic_id: CLINIC, p_counts: counts, ...(ss !== undefined ? { p_service_sessions: ss } : {}) });

  // ── ① 완납: 1:1 FIFO 동시 SET ──
  console.log('\n[완납] 실 insert 회차수만큼 1:1 마킹 + FK/flag 동시 SET');
  { const c = await mkCustomer(); await mkPackage(c, 0, 3); const s = await mkService(); const ci = await mkCheckIn(c);
    const r1 = await mkCIS(ci, s), r2 = await mkCIS(ci, s);
    const { data } = await call(ci, c, { unheated_laser: 2 }, [{ service_id: s, session_type: 'unheated_laser' }, { service_id: s, session_type: 'unheated_laser' }]);
    ok(data.inserted === 2, `inserted=2 (got ${data.inserted})`);
    ok(data.marked === 2, `marked=2 (got ${data.marked})`);
    const rows = await cis(ci); const sids = new Set((await ps(ci)).map((x) => x.id));
    ok(rows.every((r) => r.is_package_session === true && r.package_session_id && sids.has(r.package_session_id)), '동시 SET + FK가 실 session 참조');
    ok(new Set(rows.map((r) => r.package_session_id)).size === 2, '1:1 distinct (FIFO)');
    ok([r1, r2].sort().join() === rows.map((r) => r.id).sort().join(), '대상 행 정확'); }

  // ── ② C1 결정성 ──
  console.log('\n[C1] p_service_sessions 밖 service_id 미마킹 (fuzzy 금지)');
  { const c = await mkCustomer(); await mkPackage(c, 0, 3); const sIn = await mkService(), sOut = await mkService(); const ci = await mkCheckIn(c);
    const rIn = await mkCIS(ci, sIn), rOut = await mkCIS(ci, sOut);
    const { data } = await call(ci, c, { unheated_laser: 1 }, [{ service_id: sIn, session_type: 'unheated_laser' }]);
    ok(data.marked === 1, `marked=1 (got ${data.marked})`);
    const rows = await cis(ci);
    ok(rows.find((r) => r.id === rIn).package_session_id, '전달 service_id 마킹');
    ok(rows.find((r) => r.id === rOut).package_session_id === null, '미전달 service_id 미마킹'); }

  // ── ③ 부분납 shortfall phantom 방지 ──
  console.log('\n[부분납] shortfall 행 미마킹 (phantom 방지)');
  { const c = await mkCustomer(); await mkPackage(c, 0, 1); const s = await mkService(); const ci = await mkCheckIn(c);
    await mkCIS(ci, s); await mkCIS(ci, s);
    const { data } = await call(ci, c, { unheated_laser: 2 }, [{ service_id: s, session_type: 'unheated_laser' }, { service_id: s, session_type: 'unheated_laser' }]);
    ok(data.inserted === 1 && data.marked === 1, `inserted=1 marked=1 (got ${data.inserted}/${data.marked})`);
    const rows = await cis(ci);
    ok(rows.filter((r) => r.package_session_id).length === 1, '1행만 마킹');
    ok(rows.filter((r) => r.package_session_id === null && r.is_package_session === false).length === 1, 'shortfall 행 phantom 아님'); }

  // ── ④ 멱등 재호출 ──
  console.log('\n[멱등] 재호출 재소진·재마킹 0');
  { const c = await mkCustomer(); await mkPackage(c, 0, 2); const s = await mkService(); const ci = await mkCheckIn(c); await mkCIS(ci, s);
    const p = [{ service_id: s, session_type: 'unheated_laser' }];
    const d1 = (await call(ci, c, { unheated_laser: 1 }, p)).data;
    const psid1 = (await cis(ci))[0].package_session_id;
    const d2 = (await call(ci, c, { unheated_laser: 1 }, p)).data;
    ok(d1.inserted === 1 && d1.marked === 1, '1회차 소진·마킹');
    ok(d2.inserted === 0 && d2.marked === 0, '재호출 0/0');
    ok((await cis(ci))[0].package_session_id === psid1, '기존 마킹 불변');
    ok((await ps(ci)).length === 1, 'package_sessions 불변'); }

  // ── ⑤ C3 재저장 보존 + 네거티브 대조 ──
  console.log('\n[C3] 재저장(DELETE+reinsert) 마킹 보존 하드닝');
  { const c = await mkCustomer(); await mkPackage(c, 0, 2); const s = await mkService(); const ci = await mkCheckIn(c);
    await mkCIS(ci, s); await mkCIS(ci, s);
    await call(ci, c, { unheated_laser: 2 }, [{ service_id: s, session_type: 'unheated_laser' }, { service_id: s, session_type: 'unheated_laser' }]);
    const before = await cis(ci);
    const q = new Map(); before.filter((r) => r.package_session_id).forEach((r) => { const a = q.get(r.service_id) ?? []; a.push(r.package_session_id); q.set(r.service_id, a); });
    await sb.from('check_in_services').delete().eq('check_in_id', ci);
    const reins = Array.from({ length: 2 }, () => { const a = q.get(s); const psid = a && a.length ? a.shift() : null; return { check_in_id: ci, service_id: s, service_name: 'u', price: 100000, original_price: 100000, is_package_session: psid !== null, package_session_id: psid }; });
    await sb.from('check_in_services').insert(reins);
    const after = await cis(ci); const sids = new Set((await ps(ci)).map((x) => x.id));
    ok(after.filter((r) => r.package_session_id).length === 2 && after.filter((r) => r.is_package_session).length === 2, '재저장 후 2행 마킹 보존');
    ok(after.every((r) => sids.has(r.package_session_id)), '보존 FK 유효');
    // 네거티브: 하드닝 없이 naive → clobber
    await sb.from('check_in_services').delete().eq('check_in_id', ci);
    await sb.from('check_in_services').insert(Array.from({ length: 2 }, () => ({ check_in_id: ci, service_id: s, service_name: 'u', price: 100000, original_price: 100000, is_package_session: false })));
    ok((await cis(ci)).filter((r) => r.package_session_id).length === 0, '하드닝 부재 시 clobber(=회귀 실재 증명)'); }

  // ── ⑥ NULL 폴백 호환 ──
  console.log('\n[호환] p_service_sessions 미전달 → 소진만·마킹 skip');
  { const c = await mkCustomer(); await mkPackage(c, 0, 2); const s = await mkService(); const ci = await mkCheckIn(c); await mkCIS(ci, s);
    const { data, error } = await call(ci, c, { unheated_laser: 1 }, undefined);
    ok(!error, '4-arg 호환 호출 (오버로드 아님)');
    ok(data.inserted === 1 && data.marked === 0, `소진 1·마킹 0 (got ${data?.inserted}/${data?.marked})`);
    ok((await cis(ci))[0].package_session_id === null, '마킹 skip'); }

  // ── cleanup ──
  for (const ci of created.checkIns) await sb.from('check_in_services').delete().eq('check_in_id', ci);
  for (const p of created.packages) await sb.from('package_sessions').delete().eq('package_id', p);
  for (const p of created.packages) await sb.from('packages').delete().eq('id', p);
  for (const ci of created.checkIns) await sb.from('check_ins').delete().eq('id', ci);
  for (const s of created.services) await sb.from('services').delete().eq('id', s);
  for (const c of created.customers) await sb.from('customers').delete().eq('id', c);

  // ── DEV 롤백(구 4-arg 복원) — dev DB 청결 유지 ──
  await mgmt(readFileSync('supabase/migrations/20260723190000_foot_pkgsession_link_unwired_widened.rollback.sql', 'utf8'));
  console.log('\nDEV rollback → 구 4-arg 복원 완료');

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
