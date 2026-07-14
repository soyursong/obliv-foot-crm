/**
 * T-20260714-foot-DAYCLOSE-MANUALPAY-RETRO-BACKFILL-MISU-CLEANUP — Phase A MATCH REPORT
 * *** READ-ONLY. SELECT 만. 어떤 INSERT/UPDATE/DELETE 도 하지 않는다. (write 0) ***
 *
 * 대상 후보 = 버그구간(2026-07-14, 유일한 closing_manual_payments 발생일 = PAYMINI workaround 당일)
 *           ∩ 버그경로 지문(closing_manual_payments 워크어라운드 테이블에 free-text chart_number/customer_name
 *             로만 남아 canonical payments/package_payments 를 만들지 못한 레코드).
 * 각 후보 → chart_number/성함 매칭 후보를 [1:1확정 / 다중후보 모호 / 무매칭] 3분류.
 * + 잘못 남은 미수(payment_waiting / package 잔금) 후보 cross-ref.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const norm = (s) => (s ?? '').replace(/\s+/g, '').trim();
const digits = (s) => (s ?? '').replace(/\D/g, '');

const BUG_DATE = '2026-07-14';

// ── 대상 후보: 버그구간 closing_manual_payments ────────────────
const { data: cmp } = await sb.from('closing_manual_payments')
  .select('id, clinic_id, close_date, pay_time, chart_number, customer_name, lead_source, visit_type, staff_name, amount, method, memo, created_at')
  .eq('close_date', BUG_DATE).order('created_at', { ascending: true });

const CLINIC = cmp[0]?.clinic_id;

// ── 대조군: 해당 clinic 전체 customers (매칭 후보 풀) ─────────────
let custQ = sb.from('customers').select('id, name, chart_number, phone, visit_type, created_at');
const { data: allCust, error: ce } = await custQ.eq('clinic_id', CLINIC);
let customers = allCust;
if (ce) { // clinic_id 컬럼 없을 수 있음 → 전체
  const { data: c2 } = await sb.from('customers').select('id, name, chart_number, phone, visit_type, created_at');
  customers = c2;
}
console.log('=== 대조군 customers 수:', customers.length, '(clinic', CLINIC, ') ===');

// 인덱스
const byChart = new Map();   // chart_number → [cust]
const byName = new Map();    // norm(name) → [cust]
for (const c of customers) {
  const ch = norm(c.chart_number);
  if (ch) { if (!byChart.has(ch)) byChart.set(ch, []); byChart.get(ch).push(c); }
  const nm = norm(c.name);
  if (nm) { if (!byName.has(nm)) byName.set(nm, []); byName.get(nm).push(c); }
}

// ── canonical 대사: 당일 payments / package_payments (버그경로 지문 확정용) ──
const { data: payToday } = await sb.from('payments')
  .select('id, customer_id, amount, memo, created_at, check_in_id')
  .gte('created_at', BUG_DATE + 'T00:00:00').lte('created_at', BUG_DATE + 'T23:59:59');
const { data: ppToday } = await sb.from('package_payments')
  .select('id, customer_id, amount, memo, created_at')
  .gte('created_at', BUG_DATE + 'T00:00:00').lte('created_at', BUG_DATE + 'T23:59:59');
const canonCustToday = new Set([...(payToday ?? []), ...(ppToday ?? [])].map((r) => r.customer_id).filter(Boolean));

// ── payment_waiting (잘못 남은 미수 후보) ──────────────────────
const { data: pw } = await sb.from('check_ins')
  .select('id, customer_id, customer_name, customer_phone, checked_in_at')
  .eq('status', 'payment_waiting').eq('clinic_id', CLINIC);
const pwByCust = new Map();
for (const c of pw ?? []) { if (c.customer_id) { if (!pwByCust.has(c.customer_id)) pwByCust.set(c.customer_id, []); pwByCust.get(c.customer_id).push(c); } }

// ── 분류 ──────────────────────────────────────────────────────
const buckets = { '1:1확정': [], '다중후보모호': [], '무매칭': [] };
const report = [];
for (const r of cmp) {
  const chart = norm(r.chart_number);
  const name = norm(r.customer_name);
  const chartHits = chart ? (byChart.get(chart) ?? []) : [];
  const nameHits = name ? (byName.get(name) ?? []) : [];

  // 교집합(같은 고객이 chart+name 둘다 hit) 우선
  const chartIds = new Set(chartHits.map((c) => c.id));
  const bothHits = nameHits.filter((c) => chartIds.has(c.id));

  let cls, resolved = null, note = '';
  if (bothHits.length === 1) { cls = '1:1확정'; resolved = bothHits[0]; note = 'chart+성함 동시 일치 유일'; }
  else if (bothHits.length > 1) { cls = '다중후보모호'; note = `chart+성함 동시 일치 ${bothHits.length}건`; }
  else if (chartHits.length === 1 && nameHits.length === 0) { cls = '다중후보모호'; resolved = chartHits[0]; note = `chartNo 유일매칭이나 성함 불일치(입력=${r.customer_name} / DB=${chartHits[0].name})`; }
  else if (chartHits.length === 1 && nameHits.length >= 1) { cls = '다중후보모호'; resolved = chartHits[0]; note = `chartNo 유일매칭+성함은 타고객과 일치(성함 오타/오귀속 의심)`; }
  else if (chartHits.length > 1) { cls = '다중후보모호'; note = `chartNo 중복 ${chartHits.length}건`; }
  else if (chartHits.length === 0 && nameHits.length === 1) { cls = '다중후보모호'; resolved = nameHits[0]; note = `성함 유일매칭이나 chartNo 무매칭(입력chart=${r.chart_number} / DBchart=${nameHits[0].chart_number ?? '없음'})`; }
  else if (chartHits.length === 0 && nameHits.length > 1) { cls = '다중후보모호'; note = `성함 동명이인 ${nameHits.length}건, chartNo 무매칭`; }
  else { cls = '무매칭'; note = 'chartNo·성함 모두 무매칭'; }

  // 미수 cross-ref (매칭된 고객 기준)
  let misu = null;
  if (resolved) {
    const pwHits = pwByCust.get(resolved.id) ?? [];
    misu = { payment_waiting_건수: pwHits.length, canonical_당일결제_존재: canonCustToday.has(resolved.id) };
  }
  const key = cls === '1:1확정' ? '1:1확정' : cls === '무매칭' ? '무매칭' : '다중후보모호';
  buckets[key].push(r.id);
  report.push({
    cmp_id: r.id, 입력_chart: r.chart_number, 입력_성함: r.customer_name,
    금액: r.amount, method: r.method, staff: r.staff_name, memo: r.memo,
    분류: cls, 매칭고객_id: resolved?.id ?? null, 매칭고객_성함: resolved?.name ?? null, 매칭고객_chart: resolved?.chart_number ?? null,
    비고: note, chart후보수: chartHits.length, 성함후보수: nameHits.length, 미수: misu,
  });
}

console.log('\n================= 매칭 리포트 (write 0) =================');
for (const row of report) console.log(JSON.stringify(row));

console.log('\n================= 분류 집계 =================');
console.log('총 대상 후보:', cmp.length);
console.log('1:1확정   :', buckets['1:1확정'].length);
console.log('다중후보모호:', buckets['다중후보모호'].length);
console.log('무매칭    :', buckets['무매칭'].length);

// 미수 요약
const withCanon = report.filter((r) => r.미수?.canonical_당일결제_존재).length;
const withPw = report.filter((r) => (r.미수?.payment_waiting_건수 ?? 0) > 0).length;
console.log('\n--- 미수/canonical 대사 ---');
console.log('매칭고객이 당일 canonical 결제도 보유(이중입력 의심):', withCanon);
console.log('매칭고객이 payment_waiting(미해소 미수) 보유       :', withPw);
console.log('전체 payment_waiting(clinic):', (pw ?? []).length);

console.log('\n✅ MATCH 완료 (READ-ONLY, write 0).');
