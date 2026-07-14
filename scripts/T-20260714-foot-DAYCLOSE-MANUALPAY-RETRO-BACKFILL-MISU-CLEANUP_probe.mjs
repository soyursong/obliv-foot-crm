/**
 * T-20260714-foot-DAYCLOSE-MANUALPAY-RETRO-BACKFILL-MISU-CLEANUP — Phase A PROBE
 * *** READ-ONLY. SELECT 만. 어떤 INSERT/UPDATE/DELETE 도 하지 않는다. (write 0) ***
 *
 * 목적(Phase A): 급여환자 전수 수기 수납(PAYMINI workaround) + 미수 미연동(DAYCLOSE) 구간에서
 *   누적된 chart/customer 미링크 수기 수납 레코드 + 잘못 남은 미수 후보를
 *   버그구간 ∩ 버그경로 지문 교집합으로 파악한다. (단일 count 기준 금지)
 *
 * 이 스크립트는 STEP1(모집단 파악)만 담당한다:
 *   - closing_manual_payments 전체 건수 + 일자 분포(버그구간 후보 발견)
 *   - chart_number/customer_name 채움 상태 분포
 *   - payment_waiting check_ins 일자 분포(잘못 남은 미수 후보)
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('❌ env 없음'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const P = (o) => console.log(JSON.stringify(o, null, 2));

// ── closing_manual_payments 모집단 ────────────────────────────
const { data: cmp, error: e1 } = await sb
  .from('closing_manual_payments')
  .select('id, clinic_id, close_date, pay_time, chart_number, customer_name, lead_source, visit_type, staff_name, amount, method, memo, created_at')
  .order('close_date', { ascending: true });
if (e1) { console.error('closing_manual_payments 조회 실패:', e1.message); process.exit(1); }

console.log('=== closing_manual_payments 총건수:', cmp.length, '===');

// 일자 분포
const byDate = {};
for (const r of cmp) { byDate[r.close_date] = (byDate[r.close_date] || 0) + 1; }
console.log('\n--- close_date별 건수 (버그구간 후보) ---');
P(byDate);

// clinic 분포
const byClinic = {};
for (const r of cmp) { byClinic[r.clinic_id] = (byClinic[r.clinic_id] || 0) + 1; }
console.log('\n--- clinic_id별 건수 ---');
P(byClinic);

// chart_number / customer_name 채움 상태
let chartFilled = 0, chartEmpty = 0, nameFilled = 0, nameEmpty = 0;
for (const r of cmp) {
  const c = (r.chart_number ?? '').trim();
  const n = (r.customer_name ?? '').trim();
  if (c) chartFilled++; else chartEmpty++;
  if (n) nameFilled++; else nameEmpty++;
}
console.log('\n--- chart_number 채움:', chartFilled, '/ 미채움:', chartEmpty);
console.log('--- customer_name 채움:', nameFilled, '/ 미채움:', nameEmpty);

// memo 지문 분포 (버그경로 지문)
const byMemo = {};
for (const r of cmp) { const m = (r.memo ?? '(null)').slice(0, 40); byMemo[m] = (byMemo[m] || 0) + 1; }
console.log('\n--- memo 지문 분포 (상위) ---');
P(Object.fromEntries(Object.entries(byMemo).sort((a, b) => b[1] - a[1]).slice(0, 20)));

// ── payment_waiting check_ins (잘못 남은 미수 후보) ─────────────
const { data: pw, error: e2 } = await sb
  .from('check_ins')
  .select('id, clinic_id, customer_id, customer_name, customer_phone, status, checked_in_at')
  .eq('status', 'payment_waiting')
  .order('checked_in_at', { ascending: true });
if (e2) { console.error('check_ins 조회 실패:', e2.message); }
else {
  console.log('\n=== payment_waiting check_ins 총건수:', pw.length, '===');
  const pwByDate = {};
  for (const r of pw) { const d = (r.checked_in_at ?? '').slice(0, 10); pwByDate[d] = (pwByDate[d] || 0) + 1; }
  console.log('--- checked_in_at 일자별 payment_waiting 건수 ---');
  P(pwByDate);
}

console.log('\n✅ PROBE 완료 (READ-ONLY, write 0).');
