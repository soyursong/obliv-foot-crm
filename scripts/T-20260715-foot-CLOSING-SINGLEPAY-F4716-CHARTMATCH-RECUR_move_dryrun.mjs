/**
 * T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR — Option 2 MOVE dry-run 설계 (READ-ONLY)
 *
 * 목적: data-architect CONSULT(1차 게이트) 근거. 오귀속 single payments → 활성 pkg package_payments
 *   재앵커 MOVE 를 **무영속으로** 설계/시뮬레이션한다. 어떤 write 도 하지 않는다(SELECT only).
 *
 * 산출:
 *   (1) freeze셋 재검증 (active pkg · paid_amount · package_payments net)
 *   (2) 오귀속 credit 지문 매칭 (단일 count 금지 — customer+amount+memo+date+no-checkin+no-pkg 교집합)
 *   (3) 두 MOVE 변형의 net-zero/이중계상 시뮬레이션:
 *        V-A  ADDITIVE-only  : package_payments INSERT + paid_amount 재집계, single 유지  → 이중계상 검사
 *        V-B  true-MOVE      : single payments 무력화(archive-first DELETE) + package_payments INSERT → net-zero 검사
 *   (4) 매출 SSOT baseline (payments net + package_payments net + closing_manual_payments) 전/후 대조
 *
 * ★ 판정(hot-patch vs 구조적 PKG-REGEN)은 data-architect 소관(§3.1). 본 스크립트는 근거 스냅샷만.
 * author: dev-foot / 2026-07-15  (신규 prod write 0 — SELECT only)
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
const D0 = '2026-07-15', D1 = '2026-07-16';

// freeze셋 — dry-run 확정. apply(있다면) 직전 재검증 abort-guard 재사용.
const FREEZE = [
  { pkg: '5ed60da7-990c-4407-9d63-cf61e1714789', chart: 'F-4666', name: '김지민', amount: 10000, cust: '2fdb6e06-259a-4bb6-a0d5-98978038dfa8', rc: 'RC-C(single 귀속)' },
  { pkg: '3f4d3ec6-30e1-47a1-873d-3e798043f240', chart: 'F-4716', name: '김희정', amount: 59000, cust: '5050b17e-07a8-4cfa-bbbc-0717402c6142', rc: 'RC-B(pkg 재생성 credit 고아)' },
];

let abort = false;
const say = (...a) => console.log(...a);

say('════════ Option 2 MOVE dry-run (READ-ONLY · 무영속) ════════\n');

// ── (1) freeze 재검증 ──────────────────────────────────────────
say('─── (1) freeze 재검증 ───');
for (const t of FREEZE) {
  const { data: pk } = await sb.from('packages').select('*').eq('id', t.pkg).maybeSingle();
  if (!pk) { say(`  ABORT ${t.chart}: pkg 부재`); abort = true; continue; }
  const { data: pps } = await sb.from('package_payments').select('amount, payment_type, fee_kind').eq('package_id', t.pkg);
  const ppNet = (pps ?? []).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
  const s1due = Math.max(0, (pk.total_amount ?? 0) - (pk.paid_amount ?? 0));
  const s2due = Math.max(0, (pk.total_amount ?? 0) - ppNet);
  t._ppNet = ppNet; t._total = pk.total_amount; t._paid = pk.paid_amount; t._ppRows = (pps ?? []).length;
  say(`  ${t.chart} ${t.name} pkg=${t.pkg.slice(0,8)} status=${pk.status} total=${won(pk.total_amount)} paid=${won(pk.paid_amount)} pp_rows=${(pps??[]).length} pp_net=${won(ppNet)}`);
  say(`    S1(total−paid)=${won(s1due)}  S2(total−Σpp)=${won(s2due)}  ${t.rc}`);
  if (pk.status !== 'active') { say(`    ⚠ status≠active(drift)`); abort = true; }
  if (t._ppRows > 0) { say(`    ⚠ package_payments 이미 존재(drift/부분적용 의심)`); abort = true; }
}

// ── (2) 오귀속 credit 지문 매칭 (단일 count 금지) ────────────────
say('\n─── (2) 오귀속 single payments 지문 매칭 (단일 count 금지) ───');
for (const t of FREEZE) {
  const { data: pays } = await sb.from('payments').select('id, amount, method, payment_type, check_in_id, memo, created_at, customer_id')
    .eq('customer_id', t.cust).gte('created_at', D0).lt('created_at', D1);
  // 지문: customer + 금액 + payment(환불아님) + check_in_id NULL(single) + memo '영수증'/'단건' + 당일
  const match = (pays ?? []).filter((p) =>
    Number(p.amount) === t.amount &&
    p.payment_type === 'payment' &&
    !p.check_in_id &&
    /영수증|단건/.test(p.memo ?? ''));
  t._single = match;
  say(`  ${t.chart}: 당일 payments ${(pays??[]).length}행 중 지문매칭 single = ${match.length}행`);
  for (const m of match) say(`    payment ${m.id.slice(0,8)} amt=${won(m.amount)} method=${m.method} ci=${m.check_in_id?'checkin':'NULL(single)'} memo="${m.memo}" @${m.created_at}`);
  if (match.length !== 1) { say(`    ⚠ 지문매칭 ≠ 1 (단일 count 기준 UPDATE 금지 위반 소지 — freeze 재특정 필요)`); abort = true; }
}

// ── (3) MOVE 변형 시뮬레이션 (무영속) ───────────────────────────
say('\n─── (3) MOVE 변형 시뮬레이션 (무영속) ───');
say('  V-A [ADDITIVE-only] package_payments INSERT(fee_kind=package,amount) + paid_amount 재집계, single 유지');
say('  V-B [true-MOVE]     single payments archive-first DELETE + package_payments INSERT (net-zero)');
for (const t of FREEZE) {
  const single = (t._single ?? [])[0];
  if (!single) continue;
  // V-A: package_payments +amount → S2 해소되나 single(payments) 그대로 → 매출 이중계상
  const s2_after = Math.max(0, t._total - (t._ppNet + t.amount));
  say(`\n  ${t.chart} ${t.name} (${won(t.amount)}):`);
  say(`    V-A: pp_net ${won(t._ppNet)}→${won(t._ppNet + t.amount)} ⇒ S2 due→${won(s2_after)} ✅ (해소)  BUT payments single ${won(t.amount)} 잔존 ⇒ 매출에서 single+package 이중계상 +${won(t.amount)} ❌`);
  say(`    V-B: payments single(${single.id.slice(0,8)}) archive→DELETE + package_payments INSERT(${won(t.amount)}) ⇒ S1·S2 both 0 ✅, 매출 카테고리 이동(single→package) net Δ=0 ✅  단 payments 원장 접점(파괴적) ⚠`);
}

// ── (4) 매출 SSOT baseline 대조 ────────────────────────────────
say('\n─── (4) 매출 SSOT baseline (07-15) — canonical = payments net + package_payments net + closing_manual ───');
const { data: dayPay } = await sb.from('payments').select('amount, payment_type').gte('created_at', D0).lt('created_at', D1);
const payNet = (dayPay ?? []).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
const { data: dayPP } = await sb.from('package_payments').select('amount, payment_type').gte('created_at', D0).lt('created_at', D1);
const ppNetDay = (dayPP ?? []).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
const { data: dayCMP } = await sb.from('closing_manual_payments').select('amount').eq('close_date', D0);
const cmpDay = (dayCMP ?? []).reduce((s, r) => s + Number(r.amount || 0), 0);
const total = payNet + ppNetDay + cmpDay;
const moveSum = FREEZE.reduce((s, t) => s + t.amount, 0);
say(`  payments net        = ${won(payNet)} (${(dayPay??[]).length}행)`);
say(`  package_payments net= ${won(ppNetDay)} (${(dayPP??[]).length}행)`);
say(`  closing_manual      = ${won(cmpDay)} (${(dayCMP??[]).length}행)`);
say(`  ─────────────────────────────`);
say(`  canonical 합계(baseline) = ${won(total)}`);
say(`\n  ▶ V-A 적용 시 예상 합계 = ${won(total + moveSum)}  (Δ +${won(moveSum)} = 이중계상 ❌ net-zero 위반)`);
say(`  ▶ V-B 적용 시 예상 합계 = ${won(total)}          (Δ 0 = net-zero ✅, single→package 카테고리 이동만)`);

say(`\n════════ 요약 ════════`);
say(abort ? '⚠ ABORT 조건 감지 — freeze 재특정/재검증 필요.' : '✅ freeze 정합 · 지문 단일매칭 · dry-run 무영속 완료.');
say('※ net-zero MOVE 는 V-B(payments 원장 접점) 로만 성립. V-A(ADDITIVE-only)는 이중계상.');
say('※ hot-patch(V-B one-off) vs 구조적 PKG-REGEN 판정 = data-architect 소관. 본 스크립트는 근거만.');
say('⚠ READ-ONLY — write 0.');
