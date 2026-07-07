/**
 * T-20260606-foot-D1-TESTDATA-CLEANUP — 7/7 실행 게이트 READ-ONLY 재확인
 * 절대 DB write 금지. SELECT only.
 *
 * 목적: CEO A GO(MSG-20260707-163441-ohqd) 실행 직전, 6/6 스코프 데이터 전제
 *       (sims 624 ∪ 결정론 false-neg 86 = 표시매출 ₩35.2M 中 -83.94% 부풀림)이
 *       현 라이브 DB(rxlomoozakkjesdqjtvd)에 실재하는지 확인.
 *       실재 → 실행. 부재(OBE) → 실행 중단·planner FOLLOWUP.
 *
 * 실행: node scripts/verify_20260707_D1_execution_gate.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
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

// 분류 규칙 (phase05 regression 스크립트와 동일)
const RE_A1_TOKEN = [/\[TEST/i, /^\s*테스트[_\s]/, /테스트환자/, /TM\s*테스트/i, /dummy/i, /더미/, /\[검증\]/, /\[smoke\]/i, /smoke[-_ ]?test/i, /스모크/, /\[?샘플\]?/, /sample/i];
const RE_A2_FIXTURE = [/auto[-_]?done[-_]?test/i, /^c2[-_]/i, /c2[-_]?sync[-_]?test/i, /^cf\d?[-_]/i, /^E2E/i, /E2E[가-힣A-Za-z]/, /^auto[-_]/i, /^qa[-_]/i, /-\d{12,}$/];
const RE_B_NAMETEST = [/\(\s*테스트\s*\)/, /（\s*테스트\s*）/, /테스트/, /TEST/i];
const RE_B_PLACEHOLDER = [/(초진|재진|신규|체험)\s*환자\s*\d/, /환자\s*\d+\s*$/, /^김[일이삼사오육칠팔구십백천]+번$/, /인플루언서\s*\d/];
function classify(name) {
  const n = (name || '').trim();
  if (!n) return null;
  if (RE_A1_TOKEN.some(r => r.test(n))) return 'A';
  if (RE_A2_FIXTURE.some(r => r.test(n))) return 'A';
  if (RE_B_NAMETEST.some(r => r.test(n))) return 'B';
  if (RE_B_PLACEHOLDER.some(r => r.test(n))) return 'B';
  return null;
}
const won = n => '₩' + Math.round(n).toLocaleString('en-US');
const signed = r => (r.payment_type === 'refund' ? -1 : 1) * (Number(r.amount) || 0);

(async () => {
  console.log('=== 7/7 실행 게이트 재확인 (READ-ONLY) ===\n');

  const allCust = await fetchAll('customers', 'id,name,is_simulation,created_at');
  console.log(`[customers] 총: ${allCust.length}`);

  const sims = allCust.filter(c => c.is_simulation === true);
  console.log(`[scope] is_simulation=true (6/6엔 624): ${sims.length}`);

  const falses = allCust.filter(c => c.is_simulation === false);
  const setA = falses.filter(c => classify(c.name) === 'A');
  const setB = falses.filter(c => classify(c.name) === 'B');
  console.log(`[scope] false-neg (A)결정론 (6/6엔 86): ${setA.length}, (B)모호 (6/6엔 34): ${setB.length}`);

  // 확정 2 D1 고객
  const D1 = ['ae5d8c16', '27110a71'];
  const d1found = allCust.filter(c => D1.some(p => c.id.startsWith(p)));
  console.log(`[scope] 확정 2 D1고객(ae5d8c16·27110a71): ${d1found.length}건 실재`);
  d1found.forEach(c => console.log(`     - ${c.id.slice(0, 8)} "${c.name}" is_simulation=${c.is_simulation}`));

  const simIds = new Set(sims.map(c => c.id));
  const aIds = new Set(setA.map(c => c.id));
  const goIds = new Set([...simIds, ...aIds]);

  // 매출 기여
  const payments = await fetchAll('payments', 'id,customer_id,amount,status,payment_type');
  const packages = await fetchAll('packages', 'id,customer_id');
  const pkgPays = await fetchAll('package_payments', 'id,package_id,amount,payment_type');
  const pkgCustOf = new Map(packages.map(p => [p.id, p.customer_id]));

  let payTotal = 0, goPay = 0, goPayRows = 0;
  for (const p of payments) {
    if (p.status === 'deleted') continue;
    const v = signed(p);
    payTotal += v;
    if (p.customer_id && goIds.has(p.customer_id)) { goPay += v; goPayRows++; }
  }
  let pkgTotal = 0, goPkg = 0, goPkgRows = 0;
  for (const pp of pkgPays) {
    const v = signed(pp);
    pkgTotal += v;
    const cid = pkgCustOf.get(pp.package_id);
    if (cid && goIds.has(cid)) { goPkg += v; goPkgRows++; }
  }
  const grand = payTotal + pkgTotal;
  const goTotal = goPay + goPkg;

  console.log(`\n[표시매출] payments active ${won(payTotal)} + package_payments ${won(pkgTotal)} = ${won(grand)}`);
  console.log(`[GO 스코프 매출기여] payments ${won(goPay)} (${goPayRows}행) + packages ${won(goPkg)} (${goPkgRows}행) = ${won(goTotal)}`);
  console.log(`[적용 시 표시매출] ${won(grand)} - ${won(goTotal)} = ${won(grand - goTotal)}  (하락 ${grand ? (goTotal / grand * 100).toFixed(2) : 0}%)`);

  console.log('\n=== 판정 ===');
  const obe = sims.length < 100 && setA.length < 20 && d1found.length === 0;
  if (obe) {
    console.log('OBE 확정: 6/6 스코프(624 sims·86 false-neg·확정 2 D1고객) 물리적 부재.');
    console.log('→ 맹목 실행 금지. 존재하지 않는 row 마킹 + 이미 사라진 매출에 필터 적용 = 오류.');
  } else {
    console.log('스코프 데이터 실재 → 실행 진행 가능.');
  }
})().catch(e => { console.error('ERR', e); process.exit(1); });
