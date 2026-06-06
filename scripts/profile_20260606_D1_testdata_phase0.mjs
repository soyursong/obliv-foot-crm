/**
 * T-20260606-foot-D1-TESTDATA-CLEANUP — Phase 0 READ-ONLY profiling
 * 절대 DB write 금지. SELECT only.
 * 목적: is_simulation=true 624건 성격 규명 + 확정 2 테스트고객 의존그래프 전수 id.
 * 실행: node scripts/profile_20260606_D1_testdata_phase0.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const D1_START = '2026-05-16T00:00:00Z';
const D1_END = '2026-05-22T00:00:00Z'; // 05-21 inclusive
const CONFIRMED_PREFIXES = ['ae5d8c16', '27110a71'];

function chunk(arr, n) { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; }

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

async function countIn(table, col, ids) {
  // count distinct customer ids that have >=1 row in `table`
  const present = new Set();
  let rows = 0;
  for (const c of chunk(ids, 200)) {
    const { data, error } = await sb.from(table).select(`${col}`).in(col, c);
    if (error) { console.log(`  [warn] ${table}.${col}: ${error.message}`); return null; }
    rows += data.length;
    data.forEach(r => present.add(r[col]));
  }
  return { customersWithRows: present.size, totalRows: rows };
}

(async () => {
  console.log('=== Phase 0 READ-ONLY profiling — T-20260606-foot-D1-TESTDATA-CLEANUP ===\n');

  // clinics map
  const clinics = await fetchAll('clinics', 'id,slug,name');
  const slugOf = id => { const c = clinics.find(x => x.id === id); return c ? c.slug : `(unknown:${id})`; };

  // --- 1) is_simulation=true customers ---
  const sims = await fetchAll('customers',
    'id,name,phone,clinic_id,created_at,chart_number,visit_type,alt_status,is_simulation',
    q => q.eq('is_simulation', true));
  console.log(`[1] is_simulation=true customers: ${sims.length}\n`);

  // by clinic
  const byClinic = {};
  sims.forEach(c => { const s = slugOf(c.clinic_id); byClinic[s] = (byClinic[s] || 0) + 1; });
  console.log('  지점별 count:');
  Object.entries(byClinic).sort((a, b) => b[1] - a[1]).forEach(([s, n]) => console.log(`    ${s}: ${n}`));

  // created_at histogram: D1 window vs other, + monthly
  let inD1 = 0, outD1 = 0, nullCreated = 0;
  const byMonth = {};
  sims.forEach(c => {
    if (!c.created_at) { nullCreated++; return; }
    const t = c.created_at;
    if (t >= D1_START && t < D1_END) inD1++; else outD1++;
    const m = t.slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + 1;
  });
  console.log(`\n  created_at: D1창(05-16~21)=${inD1}, 그외=${outD1}, null=${nullCreated}`);
  console.log('  월별 분포:');
  Object.entries(byMonth).sort().forEach(([m, n]) => console.log(`    ${m}: ${n}`));

  // name/phone sample 20
  console.log('\n  name/phone 샘플 20건:');
  sims.slice(0, 20).forEach(c =>
    console.log(`    ${c.id.slice(0, 8)} | ${c.name} | ${c.phone} | ${slugOf(c.clinic_id)} | ${c.created_at?.slice(0,10)} | chart=${c.chart_number}`));

  // name pattern heuristic for 실고객 혼입 의심
  const testishRe = /테스트|TEST|시뮬|smoke|스모크|더미|dummy|TC[-_]?\d|샘플|sample|999/i;
  const phoneTestRe = /9999|0000|00000000|01099990|821099990/;
  const suspect = sims.filter(c => !(testishRe.test(c.name || '') || phoneTestRe.test(c.phone || '')));
  console.log(`\n  [실고객 혼입 휴리스틱] 이름/전화에 테스트패턴 없는 row: ${suspect.length} / ${sims.length}`);
  if (suspect.length) {
    console.log('  의심 row (최대 30):');
    suspect.slice(0, 30).forEach(c =>
      console.log(`    SUSPECT ${c.id.slice(0,8)} | ${c.name} | ${c.phone} | ${slugOf(c.clinic_id)} | ${c.created_at?.slice(0,10)}`));
  }

  // --- revenue reflection: payments/packages among sims ---
  const simIds = sims.map(c => c.id);
  console.log('\n[1b] 매출통계 반영 (sims 624 중):');
  for (const t of ['payments', 'packages']) {
    const r = await countIn(t, 'customer_id', simIds);
    if (r) console.log(`    ${t}: 고객 ${r.customersWithRows}명 / rows ${r.totalRows}`);
  }

  // --- 3) confirmed 2 test customers dependency graph ---
  console.log('\n[3] 확정 D1 테스트고객 2명 의존 그래프 전수 id:');
  const confirmed = sims.filter(c => CONFIRMED_PREFIXES.some(p => c.id.startsWith(p)));
  // also search by id prefix directly in case not is_simulation
  for (const pref of CONFIRMED_PREFIXES) {
    if (!confirmed.some(c => c.id.startsWith(pref))) {
      const { data } = await sb.from('customers').select('id,name,phone,clinic_id,created_at,is_simulation').ilike('id', `${pref}%`);
      if (data) data.forEach(d => confirmed.push(d));
    }
  }
  console.log(`  customers (${confirmed.length}):`);
  confirmed.forEach(c => console.log(`    ${c.id} | ${c.name} | ${c.phone} | sim=${c.is_simulation}`));
  const cids = confirmed.map(c => c.id);

  const depTables = ['reservations', 'check_ins', 'packages', 'payments'];
  const graph = { customers: confirmed.map(c => c.id) };
  for (const t of depTables) {
    const { data, error } = await sb.from(t).select('id,customer_id,created_at,status').in('customer_id', cids);
    if (error) { console.log(`  ${t}: [err] ${error.message}`); graph[t] = []; continue; }
    graph[t] = data.map(r => r.id);
    console.log(`  ${t} (${data.length}):`);
    data.forEach(r => console.log(`    ${r.id} | cust=${r.customer_id.slice(0,8)} | status=${r.status} | ${r.created_at?.slice(0,10)}`));
  }
  // package_sessions / form_submissions / payments via packages 등 누락분 탐색
  console.log('\n  [누락분 추가 탐색] 다른 테이블에서 customer_id 참조:');
  for (const t of ['package_sessions', 'form_submissions', 'reservation_logs', 'timer_records', 'medical_charts', 'clinical_images']) {
    const { data, error } = await sb.from(t).select('id,customer_id').in('customer_id', cids).limit(100);
    if (error) { console.log(`    ${t}: (n/a — ${error.message.slice(0,40)})`); continue; }
    if (data.length) console.log(`    ${t}: ${data.length} rows → ids: ${data.map(r=>r.id.slice(0,8)).join(',')}`);
    else console.log(`    ${t}: 0`);
  }

  const total = graph.customers.length + depTables.reduce((s, t) => s + graph[t].length, 0);
  console.log(`\n  의존그래프 총 id 수(customers+reservations+check_ins+packages+payments): ${total}`);
  console.log('\n=== 완료 (read-only, no writes) ===');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
