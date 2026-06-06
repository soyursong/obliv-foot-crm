/**
 * T-20260606-foot-D1-TESTDATA-CLEANUP — Phase 0.5 READ-ONLY
 * 절대 DB write 금지. SELECT only.
 *
 * 산출:
 *  (1) ₩ 회귀총액 — 제거 대상(sims 624 ∪ false-neg) 의 현재 표시매출 기여분.
 *      payments + package_payments, 지점(jongno/songdo)·월(05/06) 분해 + 전체 active 대비 %.
 *      표시매출 정의 = Sales.tsx 와 동일: payments status!=deleted, refund 음수,
 *      집계기준 accounting_date / clinic_id. package_payments 동일.
 *  (2) false-negative 테스트셋 정확화 — exact count + full UUID list,
 *      (A) 결정론 테스트태그(마킹정정 대상) / (B) 모호 실명+(테스트)(사람검토).
 *
 * 실행: node scripts/profile_20260606_D1_phase05_regression.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function fetchAll(table, select, applyFilter) {
  let out = [], from = 0; const PAGE = 1000;
  for (;;) {
    let q = sb.from(table).select(select).range(from, from + PAGE - 1);
    if (applyFilter) q = applyFilter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out = out.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// ── 분류 규칙 (3-tier) ───────────────────────────────────────
// (A) 결정론 테스트태그/자동화픽스처 — 마킹정정(is_simulation=true) 안전. 자동마킹 가능.
//   A1 = 명시 테스트 토큰, A2 = 자동화 E2E 픽스처(prefix+timestamp). 둘 다 실고객 0% 확실.
const RE_A1_TOKEN = [
  /\[TEST/i,            // [TEST-D1] 테스트환자01 등
  /^\s*테스트[_\s]/,     // 테스트_김환자, 테스트 환자
  /테스트환자/,
  /TM\s*테스트/i,
  /dummy/i, /더미/,
  /\[검증\]/, /\[smoke\]/i, /smoke[-_ ]?test/i, /스모크/,
  /\[?샘플\]?/, /sample/i,
];
const RE_A2_FIXTURE = [
  /auto[-_]?done[-_]?test/i,
  /^c2[-_]/i, /c2[-_]?sync[-_]?test/i,   // c2-sync-test-*
  /^cf\d?[-_]/i,                          // cf2-ret-*, cf4-pkg-split-*
  /^E2E/i, /E2E[가-힣A-Za-z]/,            // E2E치료메모보유*
  /^auto[-_]/i, /^qa[-_]/i,
  /-\d{12,}$/,                            // ...-1780455852053 (timestamp suffix)
];
// (B) 모호 — 실명+테스트표기 / 숫자placeholder / 합성이름·전화. 자동마킹 위험 → 사람검토(마킹 제외).
const RE_B_NAMETEST = [/\(\s*테스트\s*\)/, /（\s*테스트\s*）/, /테스트/, /TEST/i];
const RE_B_PLACEHOLDER = [
  /(초진|재진|신규|체험)\s*환자\s*\d/,    // 초진환자1~4
  /환자\s*\d+\s*$/,                        // 환자N
  /^김[일이삼사오육칠팔구십백천]+번$/,       // 김이번~김십육번 (한글수사 numbered)
  /인플루언서\s*\d/,                       // 인플루언서4
];

function classify(name) {
  const n = (name || '').trim();
  if (!n) return null;
  if (RE_A1_TOKEN.some(r => r.test(n))) return 'A';
  if (RE_A2_FIXTURE.some(r => r.test(n))) return 'A';
  if (RE_B_NAMETEST.some(r => r.test(n))) return 'B';     // '테스트/TEST' 잔여 → 사람검토
  if (RE_B_PLACEHOLDER.some(r => r.test(n))) return 'B';
  return null;
}
function subSource(name) {
  const n = (name || '').trim();
  if (RE_A1_TOKEN.some(r => r.test(n))) return 'A1-token';
  if (RE_A2_FIXTURE.some(r => r.test(n))) return 'A2-fixture';
  if (RE_B_NAMETEST.some(r => r.test(n))) return 'B-nametest';
  if (RE_B_PLACEHOLDER.some(r => r.test(n))) return 'B-placeholder';
  return '';
}

const won = n => '₩' + Math.round(n).toLocaleString('en-US');
const monthOf = (acc, created) => (acc || (created ? created.slice(0, 10) : '')).slice(0, 7);

(async () => {
  console.log('=== Phase 0.5 READ-ONLY — ₩회귀총액 + false-neg 정확화 ===\n');

  // 0) clinics
  const clinics = await fetchAll('clinics', 'id,slug,name');
  const slugOf = id => { const c = clinics.find(x => x.id === id); return c ? c.slug : `unknown:${(id||'').slice(0,8)}`; };

  // 1) sims (is_simulation=true)
  const sims = await fetchAll('customers', 'id,clinic_id', q => q.eq('is_simulation', true));
  const simIds = new Set(sims.map(c => c.id));
  console.log(`[scope] is_simulation=true: ${sims.length}`);

  // 2) false-negative — is_simulation=false 전수 스캔 후 분류
  const falses = await fetchAll('customers', 'id,name,phone,clinic_id,created_at,chart_number,is_simulation',
    q => q.eq('is_simulation', false));
  console.log(`[scan] is_simulation=false 전체: ${falses.length}`);
  const setA = [], setB = [];
  for (const c of falses) {
    const cls = classify(c.name);
    if (cls === 'A') setA.push(c);
    else if (cls === 'B') setB.push(c);
  }
  const aIds = new Set(setA.map(c => c.id));
  const bIds = new Set(setB.map(c => c.id));
  console.log(`[scope] false-neg (A)결정론: ${setA.length}, (B)모호: ${setB.length}, 합 ${setA.length + setB.length}`);

  // 제거 GO 스코프 = sims ∪ A(마킹정정). B는 사람검토 별도(매출만 별도 산출).
  const goIds = new Set([...simIds, ...aIds]);

  // 3) 매출 원천 적재 (paginate)
  const payments = await fetchAll('payments', 'id,customer_id,check_in_id,clinic_id,amount,status,payment_type,accounting_date,created_at');
  const packages = await fetchAll('packages', 'id,customer_id,clinic_id');
  const pkgPays = await fetchAll('package_payments', 'id,package_id,clinic_id,amount,payment_type,accounting_date,created_at');
  console.log(`[load] payments=${payments.length}, packages=${packages.length}, package_payments=${pkgPays.length}\n`);

  const pkgCustOf = new Map(packages.map(p => [p.id, p.customer_id]));

  // signed amount = refund 음수 (표시매출 정의)
  const signed = r => (r.payment_type === 'refund' ? -1 : 1) * (Number(r.amount) || 0);

  // 누적기: scope별 × source별 × clinic × month
  function newAgg() { return {}; } // key `${slug}|${month}` -> sum
  const add = (agg, slug, month, v) => { const k = `${slug}|${month}`; agg[k] = (agg[k] || 0) + v; };

  const result = {
    payments: { total: newAgg(), sims: newAgg(), A: newAgg(), B: newAgg(), go: newAgg() },
    pkg: { total: newAgg(), sims: newAgg(), A: newAgg(), B: newAgg(), go: newAgg() },
    counts: {
      payments_total: payments.length, payments_excluded_deleted: 0,
      pkgpay_total: pkgPays.length,
      pay_rows: { sims: 0, A: 0, B: 0, go: 0 },
      pkgpay_rows: { sims: 0, A: 0, B: 0, go: 0 },
      pay_null_customer: 0,
    },
  };

  // ── payments (status != 'deleted') ──
  for (const p of payments) {
    if (p.status === 'deleted') { result.counts.payments_excluded_deleted++; continue; }
    const slug = slugOf(p.clinic_id);
    const month = monthOf(p.accounting_date, p.created_at);
    const v = signed(p);
    add(result.payments.total, slug, month, v);
    const cid = p.customer_id;
    if (!cid) { result.counts.pay_null_customer++; continue; }
    if (simIds.has(cid)) { add(result.payments.sims, slug, month, v); result.counts.pay_rows.sims++; }
    if (aIds.has(cid)) { add(result.payments.A, slug, month, v); result.counts.pay_rows.A++; }
    if (bIds.has(cid)) { add(result.payments.B, slug, month, v); result.counts.pay_rows.B++; }
    if (goIds.has(cid)) { add(result.payments.go, slug, month, v); result.counts.pay_rows.go++; }
  }

  // ── package_payments (status 컬럼 없음 — Sales.tsx 와 동일하게 전건 집계) ──
  for (const pp of pkgPays) {
    const slug = slugOf(pp.clinic_id);
    const month = monthOf(pp.accounting_date, pp.created_at);
    const v = signed(pp);
    add(result.pkg.total, slug, month, v);
    const cid = pkgCustOf.get(pp.package_id);
    if (!cid) continue;
    if (simIds.has(cid)) { add(result.pkg.sims, slug, month, v); result.counts.pkgpay_rows.sims++; }
    if (aIds.has(cid)) { add(result.pkg.A, slug, month, v); result.counts.pkgpay_rows.A++; }
    if (bIds.has(cid)) { add(result.pkg.B, slug, month, v); result.counts.pkgpay_rows.B++; }
    if (goIds.has(cid)) { add(result.pkg.go, slug, month, v); result.counts.pkgpay_rows.go++; }
  }

  // ── 합계 헬퍼 ──
  const sumAgg = agg => Object.values(agg).reduce((s, v) => s + v, 0);
  const breakdown = agg => {
    const o = {};
    for (const [k, v] of Object.entries(agg)) o[k] = v;
    return o;
  };

  // ── 출력 ──
  const payTotal = sumAgg(result.payments.total);
  const pkgTotal = sumAgg(result.pkg.total);
  const grandActive = payTotal + pkgTotal;

  function report(label, payAgg, pkgAgg) {
    const ps = sumAgg(payAgg), ks = sumAgg(pkgAgg), tot = ps + ks;
    console.log(`\n── ${label} ──`);
    console.log(`  payments  : ${won(ps)}`);
    console.log(`  packages  : ${won(ks)} (package_payments)`);
    console.log(`  합계      : ${won(tot)}  (전체 active의 ${(grandActive ? tot / grandActive * 100 : 0).toFixed(2)}%)`);
    const bd = {};
    for (const [k, v] of Object.entries(payAgg)) bd[k] = (bd[k] || 0) + v;
    const bdk = {};
    for (const [k, v] of Object.entries(pkgAgg)) bdk[k] = (bdk[k] || 0) + v;
    console.log('  payments 지점·월:'); Object.entries(bd).sort().forEach(([k, v]) => console.log(`     ${k}: ${won(v)}`));
    console.log('  packages 지점·월:'); Object.entries(bdk).sort().forEach(([k, v]) => console.log(`     ${k}: ${won(v)}`));
    return { payments: ps, packages: ks, total: tot, pct: grandActive ? tot / grandActive * 100 : 0, pay_by: bd, pkg_by: bdk };
  }

  console.log(`\n========== 전체 ACTIVE (분모) ==========`);
  console.log(`  payments(status!=deleted): ${won(payTotal)}`);
  console.log(`  package_payments        : ${won(pkgTotal)}`);
  console.log(`  GRAND ACTIVE            : ${won(grandActive)}`);
  console.log(`  (payments deleted 제외 rows: ${result.counts.payments_excluded_deleted}, null customer_id: ${result.counts.pay_null_customer})`);

  const rSims = report('sims (is_simulation=true, 624)', result.payments.sims, result.pkg.sims);
  const rA = report('false-neg (A) 결정론 — 마킹정정 대상', result.payments.A, result.pkg.A);
  const rGo = report('★ GO 스코프 = sims ∪ A (Option A+마킹정정 적용 시 표시매출 하락분)', result.payments.go, result.pkg.go);
  const rB = report('false-neg (B) 모호 — 사람검토 별도(미반영)', result.payments.B, result.pkg.B);

  console.log(`\n========== false-neg UUID LIST ==========`);
  const a1 = setA.filter(c => subSource(c.name) === 'A1-token');
  const a2 = setA.filter(c => subSource(c.name) === 'A2-fixture');
  console.log(`\n[A] 결정론 (${setA.length}) = A1 명시토큰 ${a1.length} + A2 자동화픽스처 ${a2.length} — 마킹정정 대상:`);
  setA.sort((a, b) => subSource(a.name).localeCompare(subSource(b.name)) || (a.name || '').localeCompare(b.name || ''))
    .forEach(c => console.log(`  [${subSource(c.name)}] ${c.id} | ${c.name} | ${c.phone} | ${slugOf(c.clinic_id)} | ${c.created_at?.slice(0, 10)}`));
  console.log(`\n[B] 모호 (${setB.length}) — 사람 검토(자동마킹 제외):`);
  setB.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .forEach(c => console.log(`  [${subSource(c.name)}] ${c.id} | ${c.name} | ${c.phone} | ${slugOf(c.clinic_id)} | ${c.created_at?.slice(0, 10)}`));

  // ── evidence JSON ──
  const out = {
    generated_at: new Date().toISOString(),
    ticket: 'T-20260606-foot-D1-TESTDATA-CLEANUP',
    phase: '0.5',
    read_only: true,
    revenue_definition: "표시매출 = Sales.tsx: payments(status!=deleted) + package_payments, refund 음수, 집계 accounting_date/clinic_id. is_simulation 필터 현재 미적용(=현 표시매출에 포함됨).",
    grand_active: { payments: payTotal, package_payments: pkgTotal, total: grandActive },
    regression: {
      sims_624: rSims,
      false_neg_A_deterministic: rA,
      go_scope_sims_union_A: rGo,
      false_neg_B_ambiguous: rB,
    },
    counts: result.counts,
    false_neg: {
      A_deterministic_count: setA.length,
      B_ambiguous_count: setB.length,
      total: setA.length + setB.length,
      A1_token_count: setA.filter(c => subSource(c.name) === 'A1-token').length,
      A2_fixture_count: setA.filter(c => subSource(c.name) === 'A2-fixture').length,
      A_list: setA.map(c => ({ id: c.id, name: c.name, phone: c.phone, clinic: slugOf(c.clinic_id), created_at: c.created_at, src: subSource(c.name) })),
      B_list: setB.map(c => ({ id: c.id, name: c.name, phone: c.phone, clinic: slugOf(c.clinic_id), created_at: c.created_at, src: subSource(c.name) })),
    },
    classification_rules: {
      A_deterministic_token: RE_A1_TOKEN.map(String),
      A_deterministic_fixture: RE_A2_FIXTURE.map(String),
      B_nametest: RE_B_NAMETEST.map(String),
      B_placeholder: RE_B_PLACEHOLDER.map(String),
      note: 'A=실고객 0% 확실(자동마킹 안전). B=실명+테스트표기/숫자placeholder(사람검토,자동마킹 제외). 둘 다 안 걸린 합성의심(예 김땡땡·고냥이·파랑이)은 보수적으로 미분류(실고객 취급) — 사람 육안 권장.',
    },
  };
  const path = new URL('../evidence/T-20260606-foot-D1-TESTDATA-CLEANUP_phase05_regression.json', import.meta.url);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\n=== evidence 저장: evidence/T-20260606-foot-D1-TESTDATA-CLEANUP_phase05_regression.json ===`);
  console.log('=== 완료 (read-only, no writes) ===');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
