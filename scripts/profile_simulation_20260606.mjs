/**
 * T-20260606-foot-D1-TESTDATA-CLEANUP  Phase 0 (READ-ONLY)
 * is_simulation=true 624건 프로파일 + 확정 D1 2고객 의존 그래프 전수.
 * DB write 절대 없음. REST service-role GET only.
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map((l) => {
      const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)];
    })
);
const BASE = `${env.VITE_SUPABASE_URL}/rest/v1`;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function get(path, { count } = {}) {
  const headers = { ...H };
  if (count) { headers.Prefer = 'count=exact'; headers.Range = '0-0'; }
  const r = await fetch(`${BASE}/${path}`, { headers });
  if (count) {
    const cr = r.headers.get('content-range') || '';
    return parseInt(cr.split('/')[1] || '0', 10);
  }
  return r.json();
}

const out = {};

// ---------- 1. clinic mapping ----------
const clinics = await get('clinics?select=id,slug,name');
const clinicById = Object.fromEntries(clinics.map((c) => [c.id, c]));

// ---------- 2. all simulation customers ----------
const sims = await get('customers?is_simulation=eq.true&select=id,clinic_id,name,phone,visit_type,chart_number,created_at,created_by&order=created_at.asc&limit=2000');
out.total = sims.length;

// clinic 별 count
const byClinic = {};
for (const c of sims) {
  const slug = clinicById[c.clinic_id]?.slug || c.clinic_id || 'NULL';
  byClinic[slug] = (byClinic[slug] || 0) + 1;
}
out.byClinic = byClinic;

// created_at histogram (KST date)
const byDate = {};
for (const c of sims) {
  const kst = new Date(new Date(c.created_at).getTime() + 9 * 3600 * 1000);
  const d = kst.toISOString().slice(0, 10);
  byDate[d] = (byDate[d] || 0) + 1;
}
out.byDate = byDate;

// D1 window 05-16~21 vs other
const D1win = (d) => d >= '2026-05-16' && d <= '2026-05-21';
let inWin = 0, outWin = 0;
for (const [d, n] of Object.entries(byDate)) { if (D1win(d)) inWin += n; else outWin += n; }
out.d1Window = { '2026-05-16~21': inWin, other: outWin };

// name prefix pattern analysis (test markers)
const TESTRE = /TEST|SIM|시뮬|테스트|샘플|DEMO|더미|dummy|자동|seed|초진고객|재진고객/i;
const prefixHit = sims.filter((c) => TESTRE.test(c.name || '')).length;
out.namePatternTest = prefixHit;
out.namePatternNonTest = sims.length - prefixHit;
// list the non-pattern ones (possible real-customer mix) — FULL list, not capped
out.nonPatternSamples = sims.filter((c) => !TESTRE.test(c.name || '')).map((c) => ({ id: c.id.slice(0, 8), name: c.name, phone: c.phone, date: c.created_at.slice(0, 10), clinic: clinicById[c.clinic_id]?.slug }));

// phone pattern (test phones often +8210990xxxx sequential)
const phoneTest = sims.filter((c) => /^\+?8210990/.test((c.phone || '').replace(/-/g, ''))).length;
out.phoneTestPattern = phoneTest;

// 20 random samples
out.samples20 = sims.slice(0, 20).map((c) => ({ id: c.id.slice(0, 8), name: c.name, phone: c.phone, vt: c.visit_type, chart: c.chart_number, date: c.created_at.slice(0, 10), clinic: clinicById[c.clinic_id]?.slug }));

// ---------- 3. revenue reflection: payments/packages tied to sim customers ----------
const simIds = sims.map((c) => c.id);
// chunk helper for in() filter
function chunks(arr, n) { const r = []; for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n)); return r; }

async function relCount(table, col, ids) {
  let total = 0; const rows = [];
  for (const ch of chunks(ids, 80)) {
    const list = ch.join(',');
    const data = await get(`${table}?${col}=in.(${list})&select=*`);
    total += data.length; rows.push(...data);
  }
  return { total, rows };
}

const payRes = await relCount('payments', 'customer_id', simIds);
out.payments_on_sim = payRes.total;
const paySum = payRes.rows.reduce((s, p) => s + (Number(p.amount) || Number(p.total_amount) || 0), 0);
out.payments_on_sim_amount = paySum;
out.payment_cols = payRes.rows[0] ? Object.keys(payRes.rows[0]) : [];

const pkgRes = await relCount('packages', 'customer_id', simIds);
out.packages_on_sim = pkgRes.total;

const resvRes = await relCount('reservations', 'customer_id', simIds);
out.reservations_on_sim = resvRes.total;

const ciRes = await relCount('check_ins', 'customer_id', simIds);
out.checkins_on_sim = ciRes.total;

// payments is_simulation column?
out.payment_has_is_sim = out.payment_cols.includes('is_simulation');
if (out.payment_has_is_sim) {
  out.payments_sim_true = await get('payments?is_simulation=eq.true&select=id', { count: true });
  out.payments_sim_false_on_simcust = payRes.rows.filter((p) => p.is_simulation === false).length;
}

// ---------- 4. confirmed D1 customers dependency graph ----------
// resolve full UUID by prefix from the full customers id list (not just sims)
const allCust = await get('customers?select=id,name,is_simulation&limit=20000');
const targets = ['ae5d8c16', '27110a71'];
const depGraph = {};
for (const short of targets) {
  const match = allCust.filter((c) => c.id.startsWith(short));
  if (!match.length) { depGraph[short] = { error: 'not found in customers table' }; continue; }
  const cust = [await get(`customers?id=eq.${match[0].id}&select=*`).then((a) => a[0])];
  const id = cust[0].id;
  const arr = (x) => (Array.isArray(x) ? x : []);
  const resv = arr(await get(`reservations?customer_id=eq.${id}&select=id,status,reservation_date`));
  const ci = arr(await get(`check_ins?customer_id=eq.${id}&select=id,status,created_at`));
  const pkg = arr(await get(`packages?customer_id=eq.${id}&select=id,status`));
  const pay = arr(await get(`payments?customer_id=eq.${id}&select=id,amount,status,created_at`));
  // package_sessions via package ids
  let pkgSessions = [];
  if (pkg.length) {
    const pids = pkg.map((p) => p.id).join(',');
    pkgSessions = arr(await get(`package_sessions?package_id=in.(${pids})&select=id,status`));
  }
  depGraph[short] = {
    id, name: cust[0].name, is_simulation: cust[0].is_simulation,
    customers: 1,
    reservations: resv.length,
    check_ins: ci.length,
    packages: pkg.length,
    package_sessions: pkgSessions.length,
    payments: pay.length,
    ids: {
      customer: id,
      reservations: resv.map((r) => r.id),
      check_ins: ci.map((r) => r.id),
      packages: pkg.map((r) => r.id),
      package_sessions: pkgSessions.map((r) => r.id),
      payments: pay.map((r) => r.id),
    },
  };
}
out.dependencyGraph = depGraph;

console.log(JSON.stringify(out, null, 2));
