/**
 * T-20260609-foot-TRIAL-REVENUE-ZERO — DIAGNOSTIC (READ-ONLY, NO WRITE)
 *
 * 목적: 체험권(trial) 결제 금액이 매출집계에서 0원으로 나오는 근본 원인을
 *   write-side(데이터 0 기록) vs read-side(집계 제외)로 판별한다.
 *   *** SELECT 만 수행. write 없음. ***
 *
 * 조사 항목:
 *   1. 체험권 패키지 식별 (name LIKE '%체험%' OR trial_sessions>0)
 *   2. 해당 packages의 package_payments.amount 분포 (0 vs 값)
 *   3. visit_type='trial'/'experience' 단건 payments.amount + method
 *   4. trial session_type package_sessions + is_package_session 마킹
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));

async function fetchAll(table, columns, filter) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

console.log('═══════════════════════════════════════════════════════');
console.log(' T-20260609-foot-TRIAL-REVENUE-ZERO 진단 (READ-ONLY)');
console.log('═══════════════════════════════════════════════════════\n');

// ── 1. 체험권 패키지 식별 ──────────────────────────────────────────
const pkgs = await fetchAll(
  'packages',
  'id, customer_id, clinic_id, package_name, trial_sessions, trial_unit_price, total_amount, paid_amount, created_at, status',
).catch(async (e) => {
  // package_name 컬럼명이 다를 수 있음 → 재시도
  console.log('  (packages 1차 컬럼셋 실패, fallback) ', e.message);
  return fetchAll('packages', '*');
});

const trialPkgs = pkgs.filter(
  (p) =>
    (p.trial_sessions != null && p.trial_sessions > 0) ||
    (p.package_name && /체험/.test(p.package_name)) ||
    (p.name && /체험/.test(p.name)),
);
console.log(`[1] 전체 packages: ${pkgs.length}건 / 체험권 포함 패키지: ${trialPkgs.length}건`);
for (const p of trialPkgs.slice(0, 20)) {
  console.log(
    `    pkg ${p.id?.slice(0, 8)} | ${(p.package_name || p.name || '?')} | trial_sessions=${p.trial_sessions} trial_unit_price=${won(p.trial_unit_price)} | total_amount=${won(p.total_amount)} paid=${won(p.paid_amount)} | status=${p.status}`,
  );
}

// ── 2. 체험권 패키지의 package_payments ────────────────────────────
const trialPkgIds = new Set(trialPkgs.map((p) => p.id));
const allPkgPays = await fetchAll(
  'package_payments',
  'id, package_id, amount, method, payment_type, accounting_date, created_at, memo',
);
const trialPkgPays = allPkgPays.filter((pp) => trialPkgIds.has(pp.package_id));
console.log(`\n[2] 체험권 패키지의 package_payments: ${trialPkgPays.length}건`);
let zeroCnt = 0, nonZeroCnt = 0;
for (const pp of trialPkgPays.slice(0, 30)) {
  if ((pp.amount ?? 0) === 0) zeroCnt++;
  else nonZeroCnt++;
  console.log(
    `    pay ${pp.id?.slice(0, 8)} | pkg ${pp.package_id?.slice(0, 8)} | amount=${won(pp.amount)} | method=${pp.method} | type=${pp.payment_type} | acct=${pp.accounting_date} | memo=${pp.memo ?? ''}`,
  );
}
console.log(`    → amount=0: ${trialPkgPays.filter((p)=>(p.amount??0)===0).length}건 / amount>0: ${trialPkgPays.filter((p)=>(p.amount??0)>0).length}건`);

// ── 3. visit_type=trial/experience 단건 payments ───────────────────
const trialCheckIns = await fetchAll(
  'check_ins',
  'id, visit_type, customer_name, created_at',
  (q) => q.in('visit_type', ['trial', 'experience']),
).catch((e) => { console.log('  check_ins trial 조회 실패:', e.message); return []; });
console.log(`\n[3] visit_type=trial/experience check_ins: ${trialCheckIns.length}건`);
const trialCiIds = new Set(trialCheckIns.map((c) => c.id));
if (trialCiIds.size) {
  const ciPays = await fetchAll(
    'payments',
    'id, check_in_id, amount, method, payment_type, tax_type, accounting_date, status',
  );
  const trialCiPays = ciPays.filter((p) => trialCiIds.has(p.check_in_id));
  console.log(`    체험 check_in에 연결된 payments: ${trialCiPays.length}건`);
  for (const p of trialCiPays.slice(0, 30)) {
    console.log(
      `    pay ${p.id?.slice(0,8)} | ci ${p.check_in_id?.slice(0,8)} | amount=${won(p.amount)} | method=${p.method} | type=${p.payment_type} | tax=${p.tax_type} | status=${p.status} | acct=${p.accounting_date}`,
    );
  }
  console.log(`    → amount=0: ${trialCiPays.filter((p)=>(p.amount??0)===0).length}건 / amount>0: ${trialCiPays.filter((p)=>(p.amount??0)>0).length}건 / membership: ${trialCiPays.filter((p)=>p.method==='membership').length}건`);
}

// ── 4. trial session_type package_sessions + is_package_session ────
const trialSessions = await fetchAll(
  'package_sessions',
  'id, package_id, session_type, unit_price, status, session_date, check_in_id',
  (q) => q.eq('session_type', 'trial'),
).catch((e) => { console.log('  package_sessions trial 조회 실패:', e.message); return []; });
console.log(`\n[4] session_type=trial package_sessions: ${trialSessions.length}건`);
for (const s of trialSessions.slice(0, 15)) {
  console.log(`    sess ${s.id?.slice(0,8)} | pkg ${s.package_id?.slice(0,8)} | unit_price=${won(s.unit_price)} | status=${s.status} | date=${s.session_date} | ci=${s.check_in_id?.slice(0,8) ?? '-'}`);
}

// ── 5. check_in_services 중 체험 관련 + is_package_session ─────────
const cis = await fetchAll(
  'check_in_services',
  'id, service_name, price, is_package_session, check_in_id',
).catch((e) => { console.log('  check_in_services 조회 실패:', e.message); return []; });
const trialCis = cis.filter((c) => c.service_name && /체험/.test(c.service_name));
console.log(`\n[5] service_name LIKE '체험' check_in_services: ${trialCis.length}건`);
for (const c of trialCis.slice(0, 20)) {
  console.log(`    cis ${c.id?.slice(0,8)} | name=${c.service_name} | price=${won(c.price)} | is_package_session=${c.is_package_session} | ci=${c.check_in_id?.slice(0,8)}`);
}
console.log(`    → is_package_session=true: ${trialCis.filter((c)=>c.is_package_session===true).length}건 (true면 Closing 시술별통계에서 제외됨)`);

console.log('\n═══════════════════════════════════════════════════════');
console.log(' 진단 완료');
console.log('═══════════════════════════════════════════════════════');
