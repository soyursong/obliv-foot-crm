/**
 * T-20260715-foot-F4571-PKG12-MISREG-CORRECT — PHASE 1 READ-ONLY PROBE
 * 목적: F-4571 차트에 담당자 실수로 오등록된 '패키지 12회권' row + 연결 결제/명세/회차차감/예약 전수 파악.
 * 절대 mutation 없음 (SELECT only, 영속 0). packages/payments/service_charges 어떤 UPDATE/DELETE 도 실행하지 않음.
 * PHI(실명·전화·RRN) 는 off-git 스냅샷(~/foot-invest-snapshots) 에만. 콘솔 요약은 redacted.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 차트 식별자 후보 — 넓게 조회 후 수동 확인 (F-4571 형식 + 순수 4571 + '2')
const CHART_CANDIDATES = ['F-4571', 'F4571', '4571', 'F-2', '2'];

const mask = (s) => {
  if (!s) return s;
  const t = String(s);
  if (t.length <= 2) return t[0] + '*';
  return t.slice(0, 1) + '*'.repeat(Math.max(1, t.length - 2)) + t.slice(-1);
};

const snapshot = { generated_for: 'T-20260715-foot-F4571-PKG12-MISREG-CORRECT', note: 'READ-ONLY. off-git PHI snapshot.', customers: [], detail: {} };
const console_summary = { customers: [], packages_12: [], all_packages: [], package_sessions: [], package_payments: [], single_payments: [], service_charges: [], check_ins: [], reservations: [] };

// ── (1) 차트 후보로 customers 특정 ─────────────────────────────
const { data: customers, error: cErr } = await sb.from('customers')
  .select('id, name, phone, chart_number, clinic_id, is_simulation, created_at')
  .or(CHART_CANDIDATES.map(c => `chart_number.eq.${c}`).join(','));
console.log('=== (1) customers by chart candidates ===');
console.log('candidates:', CHART_CANDIDATES.join(', '), '| err:', cErr?.message || null, '| count:', customers?.length);
for (const c of (customers || [])) {
  snapshot.customers.push(c);
  console_summary.customers.push({ id: c.id, chart_number: c.chart_number, name_masked: mask(c.name), phone_masked: mask(c.phone), is_simulation: c.is_simulation, created_at: c.created_at });
  console.log(`  cust ${c.id} | chart=${c.chart_number} | name=${mask(c.name)} | phone=${mask(c.phone)} | sim=${c.is_simulation} | created=${c.created_at}`);
}

const custIds = (customers || []).map(c => c.id);
if (custIds.length === 0) {
  console.log('\n[!] 차트 후보로 고객 미발견 — chart_number 형식 재확인 필요. (샘플 조회)');
  const { data: sample } = await sb.from('customers').select('chart_number').ilike('chart_number', '%4571%').limit(20);
  console.log('  ilike %4571% 샘플:', JSON.stringify(sample));
}

// ── (2) 해당 고객들의 packages 전수 (12회권 focus) ────────────
const { data: pkgs, error: pErr } = await sb.from('packages')
  .select('*').in('customer_id', custIds.length ? custIds : ['00000000-0000-0000-0000-000000000000'])
  .order('created_at', { ascending: false });
console.log('\n=== (2) packages for these customers ===');
console.log('err:', pErr?.message || null, '| count:', pkgs?.length);
for (const p of (pkgs || [])) {
  snapshot.detail[p.id] = p;
  const usedCnt = null; // filled below
  const row = { id: p.id, customer_id: p.customer_id, package_name: p.package_name, package_type: p.package_type,
    total_sessions: p.total_sessions, total_amount: p.total_amount, paid_amount: p.paid_amount, status: p.status,
    created_by: p.created_by, contract_date: p.contract_date, created_at: p.created_at,
    transferred_from: p.transferred_from, transferred_to: p.transferred_to, memo: p.memo };
  console_summary.all_packages.push(row);
  if (p.total_sessions === 12) console_summary.packages_12.push(row);
  console.log(`  pkg ${p.id} | name=${p.package_name} | type=${p.package_type} | total_sessions=${p.total_sessions} | amt=${p.total_amount} paid=${p.paid_amount} | status=${p.status} | by=${p.created_by} | created=${p.created_at}`);
}

const pkgIds = (pkgs || []).map(p => p.id);
const pkgIn = pkgIds.length ? pkgIds : ['00000000-0000-0000-0000-000000000000'];

// ── (3) package_sessions — 회차 차감 이력 ──────────────────────
const { data: psess, error: sErr } = await sb.from('package_sessions')
  .select('*').in('package_id', pkgIn).order('session_number', { ascending: true });
console.log('\n=== (3) package_sessions (회차차감 이력) ===');
console.log('err:', sErr?.message || null, '| count:', psess?.length);
for (const s of (psess || [])) {
  console_summary.package_sessions.push({ id: s.id, package_id: s.package_id, check_in_id: s.check_in_id, session_number: s.session_number, session_type: s.session_type, session_date: s.session_date, status: s.status, unit_price: s.unit_price, performed_by: s.performed_by });
  console.log(`  sess pkg=${s.package_id} #${s.session_number} | type=${s.session_type} | date=${s.session_date} | status=${s.status} | check_in=${s.check_in_id || '-'}`);
}

// ── (4) package_payments — 패키지 결제 ─────────────────────────
const { data: ppay, error: ppErr } = await sb.from('package_payments')
  .select('*').in('package_id', pkgIn).order('created_at', { ascending: true });
console.log('\n=== (4) package_payments ===');
console.log('err:', ppErr?.message || null, '| count:', ppay?.length);
for (const p of (ppay || [])) {
  console_summary.package_payments.push({ id: p.id, package_id: p.package_id, amount: p.amount, method: p.method, payment_type: p.payment_type, vat_amount: p.vat_amount, created_at: p.created_at });
  console.log(`  ppay pkg=${p.package_id} | amt=${p.amount} | ${p.method} | ${p.payment_type} | ${p.created_at}`);
}

// ── (5) payments (단건) — 이 고객들 전체 (패키지 귀속 여부는 check_in 경유) ──
const { data: pay, error: payErr } = await sb.from('payments')
  .select('*').in('customer_id', custIds.length ? custIds : ['00000000-0000-0000-0000-000000000000'])
  .order('created_at', { ascending: true });
console.log('\n=== (5) payments (단건, 고객 전체) ===');
console.log('err:', payErr?.message || null, '| count:', pay?.length);
for (const p of (pay || [])) {
  console_summary.single_payments.push({ id: p.id, check_in_id: p.check_in_id, customer_id: p.customer_id, amount: p.amount, method: p.method, payment_type: p.payment_type, created_at: p.created_at, memo: p.memo });
  console.log(`  pay ${p.id} | check_in=${p.check_in_id || '-'} | amt=${p.amount} | ${p.method} | ${p.payment_type} | ${p.created_at}`);
}

// ── (6) service_charges (명세/수가) — 고객 전체 ────────────────
const { data: svc, error: svcErr } = await sb.from('service_charges')
  .select('*').in('customer_id', custIds.length ? custIds : ['00000000-0000-0000-0000-000000000000'])
  .order('calculated_at', { ascending: true });
console.log('\n=== (6) service_charges (명세) ===');
console.log('err:', svcErr?.message || null, '| count:', svc?.length);
for (const s of (svc || [])) {
  console_summary.service_charges.push({ id: s.id, check_in_id: s.check_in_id, service_id: s.service_id, is_insurance_covered: s.is_insurance_covered, base_amount: s.base_amount, copayment_amount: s.copayment_amount, insurance_covered_amount: s.insurance_covered_amount, calculated_at: s.calculated_at });
  console.log(`  svc ${s.id} | check_in=${s.check_in_id} | base=${s.base_amount} copay=${s.copayment_amount} covered=${s.insurance_covered_amount} | ins=${s.is_insurance_covered} | ${s.calculated_at}`);
}

// ── (7) check_ins (package_id 연결 포함) ───────────────────────
const { data: cis, error: ciErr } = await sb.from('check_ins')
  .select('id, customer_id, reservation_id, package_id, visit_type, status, checked_in_at, completed_at, created_at')
  .in('customer_id', custIds.length ? custIds : ['00000000-0000-0000-0000-000000000000'])
  .order('created_at', { ascending: true });
console.log('\n=== (7) check_ins ===');
console.log('err:', ciErr?.message || null, '| count:', cis?.length);
for (const c of (cis || [])) {
  console_summary.check_ins.push(c);
  console.log(`  ci ${c.id} | pkg=${c.package_id || '-'} | resv=${c.reservation_id || '-'} | ${c.visit_type} | ${c.status} | created=${c.created_at}`);
}

// ── (8) reservations ───────────────────────────────────────────
const { data: resv, error: rErr } = await sb.from('reservations')
  .select('id, customer_id, reservation_date, reservation_time, visit_type, service_id, status, created_by, created_at')
  .in('customer_id', custIds.length ? custIds : ['00000000-0000-0000-0000-000000000000'])
  .order('created_at', { ascending: true });
console.log('\n=== (8) reservations ===');
console.log('err:', rErr?.message || null, '| count:', resv?.length);
for (const r of (resv || [])) {
  console_summary.reservations.push(r);
  console.log(`  resv ${r.id} | ${r.reservation_date} ${r.reservation_time} | ${r.visit_type} | ${r.status} | by=${r.created_by}`);
}

// ── off-git 상세 스냅샷 (PHI 포함) + 콘솔 redacted 스냅샷 저장 ──
snapshot.detail_full = { packages: pkgs, package_sessions: psess, package_payments: ppay, payments: pay, service_charges: svc, check_ins: cis, reservations: resv };
const offgit = `${homedir()}/foot-invest-snapshots/T-20260715-F4571-PKG12_fulldetail.json`;
writeFileSync(offgit, JSON.stringify(snapshot, null, 2));
const redactedPath = `${homedir()}/foot-invest-snapshots/T-20260715-F4571-PKG12_redacted.json`;
writeFileSync(redactedPath, JSON.stringify(console_summary, null, 2));
console.log('\n=== SAVED ===');
console.log('off-git full (PHI):', offgit);
console.log('off-git redacted  :', redactedPath);
console.log('\n[DONE] READ-ONLY. no mutations executed.');
