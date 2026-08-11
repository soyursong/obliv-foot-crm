/**
 * T-20260811-foot-CHARTEDIT-TRIAL-PRICE-BACKFILL — READ-ONLY G-GATE + DRY-RUN
 *
 * ⚠ SELECT/시뮬레이션만. 어떤 write 도 하지 않는다 (apply_before_go 금지).
 *   실제 apply 는 supervisor 검증 + DB-GATE GO-token 발행 후 별도 _apply 스크립트로만 집행.
 *
 * 목적: 통계>담당치료사별>이정인>차감기준 체험권 4건의 unit_price=0 오염을 정정.
 *   SET package_sessions.unit_price = 해당 행 package 의 trial_unit_price (SSOT, 하드코딩 금지).
 *   필드 owner 기대 = 10,000원. 실 trial_unit_price != 10,000 이면 ABORT.
 *
 * per-row freeze set (정확 4행, 확장 금지):
 *   performed_by=이정인 AND session_type='trial'
 *   AND session_date IN ('2026-08-06','2026-08-07')
 *   AND customer chart IN (F-5537, F-5727, F-5668, F-5538) AND unit_price=0
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));

// 기대 대상 (owner demand, per-row) — chart 정규화(끝 4자리 숫자)로 대조
const EXPECT = [
  { name: '차민주', chart: 'F-5537', date: '2026-08-07' },
  { name: '정석현', chart: 'F-5727', date: '2026-08-07' },
  { name: '우경아', chart: 'F-5668', date: '2026-08-06' },
  { name: '강득중', chart: 'F-5538', date: '2026-08-06' },
];
const normChart = (c) => (c == null ? '' : String(c).replace(/[^0-9]/g, '').replace(/^0+/, ''));
const expectChartSet = new Set(EXPECT.map((e) => normChart(e.chart)));

// 이정인 staff id 확정
const { data: staff, error: sErr } = await sb.from('staff').select('id, name').eq('name', '이정인');
if (sErr) throw new Error('staff: ' + sErr.message);
if (!staff || staff.length !== 1) {
  console.log(`❌ ABORT: 이정인 staff 행 ${staff?.length ?? 0}개 (기대 1). 확장/모호 → planner 재확인.`);
  process.exit(1);
}
const leejeonginId = staff[0].id;
console.log(`이정인 staff id = ${leejeonginId}`);

// 술어 SELECT — per-row freeze 후보
const { data: rows, error } = await sb
  .from('package_sessions')
  .select(`
    id, unit_price, surcharge, session_date, status, session_type, performed_by, deleted_at,
    packages!inner(
      id, trial_unit_price, customer_id,
      customers!packages_customer_id_fkey(id, name, chart_number)
    )
  `)
  .eq('performed_by', leejeonginId)
  .eq('session_type', 'trial')
  .in('session_date', ['2026-08-06', '2026-08-07']);
if (error) throw new Error('package_sessions: ' + error.message);

console.log(`\n술어 매치(performed_by=이정인 ∧ trial ∧ 08-06/07): ${rows.length}행 (전건, unit_price 무관)`);
for (const r of rows) {
  const c = r.packages?.customers;
  console.log(`  ${r.id} | ${r.session_date} | up=${won(r.unit_price)} | trial_up=${won(r.packages?.trial_unit_price)} | chart=${c?.chart_number ?? '-'} | ${c?.name ?? '-'} | status=${r.status} | del=${r.deleted_at ?? 'null'}`);
}

// freeze set 후보 = unit_price=0 AND chart ∈ expect
const cand = rows.filter((r) => (r.unit_price ?? 0) === 0
  && expectChartSet.has(normChart(r.packages?.customers?.chart_number)));

console.log(`\n═══ G-GATE: freeze set 후보(unit_price=0 ∧ chart∈기대4) = ${cand.length}행 ═══`);

// 정확 4행 검증 (중복/누락 0)
const seenChart = new Set();
let dup = false;
for (const r of cand) {
  const nc = normChart(r.packages?.customers?.chart_number);
  if (seenChart.has(nc)) dup = true;
  seenChart.add(nc);
}
const missing = [...expectChartSet].filter((c) => !seenChart.has(c));

let abort = false;
if (cand.length !== 4) { console.log(`❌ ABORT: 후보 ${cand.length}행 ≠ 4행.`); abort = true; }
if (dup) { console.log(`❌ ABORT: chart 중복 존재.`); abort = true; }
if (missing.length) { console.log(`❌ ABORT: 누락 chart = ${missing.join(',')}`); abort = true; }

// trial_unit_price 검증 (기대 10,000 / 하드코딩 금지 = 실값 사용, 단 10,000 아니면 ABORT+재확인)
console.log(`\n── SET 값(각 행 package.trial_unit_price) 검증 ──`);
for (const r of cand) {
  const tup = r.packages?.trial_unit_price;
  const ok = tup === 10000;
  console.log(`  ${r.id} | trial_unit_price=${won(tup)} ${ok ? '✓' : '⚠ (10,000 아님)'}`);
  if (tup == null || tup <= 0) { console.log(`    ❌ ABORT: trial_unit_price 무효(${tup}).`); abort = true; }
  else if (tup !== 10000) { console.log(`    ⚠ 실값 ${won(tup)} ≠ owner 기대 10,000 → planner 재확인 필요(임의 하드코딩 금지).`); abort = true; }
}

// before-image (archive 후보)
console.log(`\n── BEFORE-IMAGE (archive 대상) ──`);
const beforeImage = cand.map((r) => ({
  pk: r.id,
  unit_price: r.unit_price,
  session_type: r.session_type,
  session_date: r.session_date,
  performed_by: r.performed_by,
  status: r.status,
  deleted_at: r.deleted_at,
  package_id: r.packages?.id,
  trial_unit_price_target: r.packages?.trial_unit_price,
  chart_number: r.packages?.customers?.chart_number,
  customer_name: r.packages?.customers?.name,
}));
console.log(JSON.stringify(beforeImage, null, 2));

console.log(`\n═══ DRY-RUN 제안 UPDATE (무영속) ═══`);
for (const b of beforeImage) {
  console.log(`  UPDATE package_sessions SET unit_price=${won(b.trial_unit_price_target)} WHERE id='${b.pk}';  -- ${b.customer_name}/${b.chart_number} ${b.unit_price}→${b.trial_unit_price_target}`);
}
console.log(`\n복구 매출 영향(4행 합계): ${won(beforeImage.reduce((s, b) => s + (b.trial_unit_price_target ?? 0), 0))}원`);

if (abort) {
  console.log(`\n❌❌ G-GATE ABORT — 위 조건 미충족. apply 진행 금지, planner 보고.`);
  process.exit(2);
}
console.log(`\n✅ G-GATE PASS — 정확 4행 freeze 확정. archive-first → supervisor DB-GATE GO-token 대기.`);
console.log(`freeze PK: ${beforeImage.map((b) => b.pk).join(', ')}`);
console.log(`\n⚠ 실제 apply 없음 — GO-token 발행 후 _apply 스크립트로만 집행.`);
