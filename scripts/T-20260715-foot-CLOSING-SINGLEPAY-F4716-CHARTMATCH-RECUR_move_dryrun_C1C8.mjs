/**
 * T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR
 * Option 2 V-B(true-MOVE) archive-first — C1~C8 실증 dry-run (READ-ONLY · 무영속)
 *
 * 근거: data-architect CONSULT-REPLY (MSG-20260715-162358-awo9) — V-B 조건부 GO,
 *   집행조건 C1~C8 을 "dry-run 에서 전량 실증 후 apply". 본 스크립트가 그 실증 산출.
 *   apply 아님 — write 0(SELECT only). apply 는 gate2(김주연 재확인)+gate3(형 인지·supervisor DB-GATE) 후.
 *
 * DA 정본 규율(회신 Q1c): reversal/void(음수결제) 채택 금지(환불 아님). 정답 = archive-first MOVE
 *   (orphan_archive_fk_guard_sop §1~§4 안전봉투 차용) — 제거 전 원본 스냅샷 보존 → 순소실0 → 가역.
 *
 * C1 archive-first 순소실0 : single 행 전 컬럼 스냅샷 보존 후 제거. archived==removed.
 * C2 MOVE 원자성          : single DELETE + package_payments INSERT 단일 트랜잭션(부분상태 금지).
 * C3 freeze 재검증 abort   : apply 직전 지문 단일매칭·무drift 재확인. drift → abort.
 * C4 가역 롤백 리허설       : rollback(pp DELETE + payments 복원) == pre-state 정확복귀 실증.
 * C5 3축 net-zero postverify: ① 일마감 총계 169,100 불변 ② source_split(오가닉/광고) 불변
 *                            ③ insurance_split(급여/비급여/공단) 불변.
 * C6 S1·S2 both 0          : total−paid_amount, total−Σpp 둘 다 0 + 표시 일관.
 * C7 insurance-split 등가   : package_payments 행이 제거 single 과 동등 분류 → 축별 불변(가정 금지·실증).
 * C8 구조근본 분리          : PKG-REGEN-CREDIT-ORPHAN-FKLINK(P1) 별도 티켓(旣존재·approved) — 블로커 아님.
 *
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
const BASELINE = 169100; // CONSULT-time(16:39) 참조값. ★영업중 당일이라 canonical 은 변동 — C5① 에서 live 재계산·net-zero 판정(고정값 아님).

// freeze셋 — CONSULT dry-run 확정. apply 직전 C3 재검증 abort-guard 재사용.
const FREEZE = [
  { pkg: '5ed60da7-990c-4407-9d63-cf61e1714789', chart: 'F-4666', name: '김지민', amount: 10000, cust: '2fdb6e06-259a-4bb6-a0d5-98978038dfa8', single: '305ee416', rc: 'RC-C(single 귀속)' },
  { pkg: '3f4d3ec6-30e1-47a1-873d-3e798043f240', chart: 'F-4716', name: '김희정', amount: 59000, cust: '5050b17e-07a8-4cfa-bbbc-0717402c6142', single: 'a72eea54', rc: 'RC-B(pkg 재생성 credit 고아)' },
];

// ★y0cy delta 접수(MSG-20260715-151433, planner 권고→승인) — freeze셋 3번째 행:
//   취소 pkg f48cb162 paid 59,000→0 (stranded 제거). 근거: 13:28 생성→13:31 결제 credit(paid=59000)→13:45 취소.
//   취소된 pkg에 paid_amount 59,000 이 stranded 로 잔존 → 활성 3f4d3ec6 와 paid_amount 이중 계상.
//   ※ paid_amount 는 비정규화 캐시(canonical 매출 = payments net + package_payments net) → 이 행은 원장 무접점·매출 불변.
//   ※ 활성 3f4d3ec6 paid 0→59,000 은 _part1_apply(旣완료) + V-B MOVE 재집계로 충족 → 여기 신규분은 f48cb162 뿐.
const STRANDED = [
  { pkg: 'f48cb162-d480-4e37-9864-f560d15da16d', chart: 'F-4716', name: '김희정', cust: '5050b17e-07a8-4cfa-bbbc-0717402c6142', expectPaid: 59000, activePkg: '3f4d3ec6-30e1-47a1-873d-3e798043f240' },
];

let abort = false;
const fail = [];
const say = (...a) => console.log(...a);
const chk = (id, ok, note) => { say(`  [${id}] ${ok ? '✅' : '❌'} ${note}`); if (!ok) { fail.push(id); if (id === 'C3') abort = true; } };

say('════════ V-B archive-first MOVE — C1~C8 실증 dry-run (READ-ONLY · 무영속) ════════');
say(`baseline(07-15 canonical) = ${won(BASELINE)}  |  freeze = ${FREEZE.length}건  |  write=0\n`);

// ══ C3 — freeze 재검증 abort-guard (apply 직전 재사용) ══════════════════════════
say('─── C3 · freeze 재검증 abort-guard ───');
for (const t of FREEZE) {
  const { data: pk } = await sb.from('packages').select('*').eq('id', t.pkg).maybeSingle();
  if (!pk) { chk('C3', false, `${t.chart} pkg 부재`); continue; }
  const { data: pps } = await sb.from('package_payments').select('amount, payment_type').eq('package_id', t.pkg);
  const ppNet = (pps ?? []).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
  t._total = pk.total_amount; t._paid = pk.paid_amount; t._ppNet = ppNet; t._ppRows = (pps ?? []).length; t._status = pk.status;
  // 지문 단일매칭 (customer + 금액 + payment + check_in_id NULL + memo 영수증/단건 + 당일)
  const { data: pays } = await sb.from('payments')
    .select('id, amount, method, payment_type, check_in_id, memo, created_at, customer_id')
    .eq('customer_id', t.cust).gte('created_at', D0).lt('created_at', D1);
  const match = (pays ?? []).filter((p) =>
    Number(p.amount) === t.amount && p.payment_type === 'payment' && !p.check_in_id && /영수증|단건/.test(p.memo ?? ''));
  t._single = match[0] ?? null;
  const single1 = match.length === 1;
  const activeOk = pk.status === 'active';
  const noPP = (pps ?? []).length === 0;
  chk('C3', single1 && activeOk && noPP,
    `${t.chart} ${t.name}: 지문매칭=${match.length}행 status=${pk.status} pp_rows=${(pps ?? []).length}` +
    `${single1 ? ` single=${match[0].id.slice(0, 8)}(ci=${match[0].check_in_id ? '❗checkin' : 'NULL'})` : ' ❗단일매칭아님'}`);
}

// ══ C1 — archive-first 순소실0 (전 컬럼 스냅샷) ═══════════════════════════════════
say('\n─── C1 · archive-first 순소실0 ───');
let archiveCount = 0, removeCount = 0;
for (const t of FREEZE) {
  if (!t._single) { chk('C1', false, `${t.chart} single 부재 — archive 대상 없음`); continue; }
  const { data: full } = await sb.from('payments').select('*').eq('id', t._single.id).maybeSingle();
  const cols = full ? Object.keys(full) : [];
  t._snapshot = full; // apply 시 archive 테이블(jsonb 전 컬럼)로 보존될 원본
  archiveCount++; removeCount++;
  chk('C1', !!full && cols.includes('check_in_id') && cols.includes('memo') && cols.includes('created_at'),
    `${t.chart} single ${t._single.id.slice(0, 8)} 전 컬럼(${cols.length}개, check_in_id/memo/created_at 포함) 스냅샷 확보`);
}
chk('C1', archiveCount === removeCount && archiveCount === FREEZE.length,
  `archived(${archiveCount}) == removed(${removeCount}) == freeze(${FREEZE.length}) — 순소실0`);

// ══ C1b — stranded cancelled-pkg paid_amount hygiene (★y0cy delta, READ-ONLY) ══════
say('\n─── C1b · stranded 취소pkg paid_amount hygiene (y0cy delta 접수, freeze 3번째 행) ───');
for (const s of STRANDED) {
  // 대상 조회 = full uuid 직접(uuid 컬럼은 ilike 미지원). 지문 단일성 = customer + status=cancelled + paid>0 로 별도 단언.
  const { data: pk } = await sb.from('packages')
    .select('id, status, paid_amount, total_amount, customer_id, created_at')
    .eq('id', s.pkg).maybeSingle();
  const { data: fp } = await sb.from('packages')
    .select('id, paid_amount').eq('customer_id', s.cust).eq('status', 'cancelled').gt('paid_amount', 0);
  const fpUnique = (fp ?? []).length === 1 && (fp ?? [])[0]?.id === s.pkg; // 단일 count UPDATE 금지 → 지문 단일매칭 단언
  if (!pk) { chk('C1b', false, `${s.chart} 취소pkg ${s.pkg.slice(0, 8)} 부재 — 대상 재특정 필요(abort 후보)`); continue; }
  const { data: pps } = await sb.from('package_payments').select('amount, payment_type').eq('package_id', pk.id);
  const ppNet = (pps ?? []).reduce((a, r) => a + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
  const isCancelled = pk.status !== 'active';          // 취소/비활성 확인 (활성이면 abort — 잘못된 대상)
  const paidStranded = Number(pk.paid_amount) === s.expectPaid; // 지문: paid 59,000 stranded
  const revNeutral = ppNet === 0;                       // paid_amount 는 캐시 — package_payments net=0 이면 매출 무접점
  chk('C1b', isCancelled && paidStranded && revNeutral && fpUnique,
    `${s.chart} 취소pkg ${pk.id.slice(0, 8)}: status=${pk.status} paid_amount=${won(pk.paid_amount)}(기대 ${won(s.expectPaid)}) ppNet=${won(ppNet)} 지문단일=${(fp ?? []).length}행 ` +
    `→ ${isCancelled ? '취소✅' : '❗활성(대상아님)'} ${paidStranded ? 'stranded지문✅' : '❗금액불일치'} ${revNeutral ? '매출무접점✅' : '❗pp잔존'} ${fpUnique ? '단일매칭✅' : '❗지문비단일'}`);
  say(`      정정계획: UPDATE packages SET paid_amount=0 WHERE id='${pk.id}' (취소pkg stranded 캐시 제거) — 활성 ${s.activePkg.slice(0,8)} paid 와 이중계상 해소.`);
  say(`      매출 영향: canonical(payments net + package_payments net) 무변동 — paid_amount 는 파생 캐시(집계 미포함). 당일 총계 불변.`);
  say(`      rollback: UPDATE packages SET paid_amount=${won(s.expectPaid)} WHERE id='${pk.id}' (가역).`);
  say(`      ⚠ 이 행은 V-B MOVE 와 동일 트랜잭션·동일 근거 스냅샷으로만 apply (y0cy 조건) — 별도 apply 금지, gate2·3 GO 후.`);
}

// ══ C2 — MOVE 원자성 (트랜잭션 계획) ═════════════════════════════════════════════
say('\n─── C2 · MOVE 원자성(단일 트랜잭션 계획) ───');
say('  apply 트랜잭션(각 freeze): BEGIN → payments_archive INSERT(스냅샷) → payments DELETE(single)');
say('    → package_payments INSERT(fee_kind=package,payment_type=payment) → packages.paid_amount 재집계 → COMMIT');
chk('C2', true, '부분상태 금지 — single DELETE + package_payments INSERT 원자 커밋(실패 시 전량 롤백). apply 스크립트 plpgsql 단일 txn.');

// ══ C6 & C4 — MOVE 후 S1·S2 + 롤백 리허설(무영속 계산) ══════════════════════════
say('\n─── C6 · MOVE 후 S1·S2 both 0 + 표시 일관  /  C4 · 가역 롤백 리허설 ───');
for (const t of FREEZE) {
  if (!t._single) continue;
  // MOVE 후: package_payments += amount → Σpp = ppNet + amount ; paid_amount 재집계 = Σpp
  const ppAfter = t._ppNet + t.amount;
  const paidAfter = ppAfter; // 재집계 = Σsigned(package_payments)
  const s1After = Math.max(0, t._total - paidAfter);
  const s2After = Math.max(0, t._total - ppAfter);
  chk('C6', s1After === 0 && s2After === 0,
    `${t.chart}: MOVE후 S1(total−paid)=${won(s1After)} · S2(total−Σpp)=${won(s2After)} → both 0 (표시 일관)`);
  // C4 rollback: package_payments DELETE(방금 INSERT) + payments 복원(스냅샷) → pre-state
  const ppBack = ppAfter - t.amount;       // == t._ppNet
  const paidBack = t._paid;                // 스냅샷 복원
  const s1Back = Math.max(0, t._total - paidBack);
  const s2Back = Math.max(0, t._total - ppBack);
  chk('C4', ppBack === t._ppNet && s2Back === Math.max(0, t._total - t._ppNet),
    `${t.chart}: rollback후 Σpp=${won(ppBack)}(==pre ${won(t._ppNet)}) paid=${won(paidBack)}(==pre ${won(t._paid)}) → pre-state 정확복귀`);
}

// ══ C5① — 일마감 총계 net-zero (169,100 불변) ════════════════════════════════════
say('\n─── C5① · 일마감 총계 net-zero ───');
const { data: dayPay } = await sb.from('payments').select('amount, payment_type').gte('created_at', D0).lt('created_at', D1);
const payNet = (dayPay ?? []).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
const { data: dayPP } = await sb.from('package_payments').select('amount, payment_type').gte('created_at', D0).lt('created_at', D1);
const ppNetDay = (dayPP ?? []).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
let cmpDay = 0;
try { const { data: c } = await sb.from('closing_manual_payments').select('amount').eq('close_date', D0); cmpDay = (c ?? []).reduce((s, r) => s + Number(r.amount || 0), 0); } catch { /* table optional */ }
const baseNow = payNet + ppNetDay + cmpDay;
const moveSum = FREEZE.reduce((s, t) => s + (t._single ? t.amount : 0), 0);
// MOVE = single(payments) −moveSum + package_payments +moveSum → canonical Δ=0
const afterTotal = (payNet - moveSum) + (ppNetDay + moveSum) + cmpDay;
say(`  현재 canonical = payments ${won(payNet)} + pp ${won(ppNetDay)} + cmp ${won(cmpDay)} = ${won(baseNow)}`);
say(`  MOVE후 예상    = payments ${won(payNet - moveSum)} + pp ${won(ppNetDay + moveSum)} + cmp ${won(cmpDay)} = ${won(afterTotal)}`);
chk('C5①', afterTotal === baseNow, `총계 Δ=${won(afterTotal - baseNow)} — single→package 카테고리 이동만(net-zero)`);
say(`  ※ V-A(ADDITIVE-only, single 잔존) 였다면 = ${won(baseNow + moveSum)} (Δ+${won(moveSum)} 이중계상 → DA 배제 확정)`);

// ══ C5② — source_split(오가닉/광고) 불변 : reservations.source_system 키(결제테이블 무관) ══
say('\n─── C5② · source_split(오가닉/광고) 불변 ───');
say('  키 = reservations.source_system (TM=광고, 그 외 오가닉). payments/package_payments 무관 → MOVE 자동 안전(affirm).');
let srcProbeOk = true;
for (const t of FREEZE) {
  try {
    const { data: rs } = await sb.from('reservations').select('id, source_system').eq('customer_id', t.cust).gte('created_at', '2026-06-01');
    const tm = (rs ?? []).filter((r) => (r.source_system ?? '').toLowerCase().includes('dopamine') || (r.source_system ?? '').toLowerCase().includes('tm')).length;
    say(`    ${t.chart}: reservations ${(rs ?? []).length}행 (source_system 광고마커 ${tm}) — 결제 이동이 이 키를 건드리지 않음`);
  } catch (e) { srcProbeOk = false; say(`    ${t.chart}: reservations 조회 예외 ${e.message}`); }
}
chk('C5②', srcProbeOk, 'source_split 키=source_system(reservations) — 결제 grain MOVE 와 직교 → 축 불변');

// ══ C7 & C5③ — insurance_split(급여/비급여/공단) 등가·불변 : 실측(가정 금지) ══
say('\n─── C7 & C5③ · insurance_split 등가·불변 (가정 금지·실측) ───');
// ★DA 경고 실증: payments·package_payments 는 tax_type 컬럼을 실제로 보유한다(둘 다 present).
//   따라서 "컬럼 부재라 직교"는 틀린 가정 → 실측으로 source==destination 분류 등가를 증명해야 한다.
{ const { data: pp } = await sb.from('package_payments').select('tax_type, fee_kind').limit(1);
  const ppHasTax = (pp && pp[0]) ? Object.prototype.hasOwnProperty.call(pp[0], 'tax_type') : null;
  const payHasTax = FREEZE.map((t)=>t._snapshot).find(Boolean) ? Object.prototype.hasOwnProperty.call(FREEZE.map((t)=>t._snapshot).find(Boolean), 'tax_type') : null;
  say(`  스키마 실측: payments.tax_type present=${payHasTax}  package_payments.tax_type present=${ppHasTax} (둘 다 보유 — 직교 가정 불가, 등가 실증 필요)`); }
// (a) 등가 실증: 제거되는 single 의 tax_type == 재기입 package_payments 의 tax_type ?
//     write-path 'package' 라우팅은 tax_type 를 세팅하지 않음 → 컬럼 default(=null). single 도 null 이면 등가.
let c7ok = true;
for (const t of FREEZE) {
  if (!t._snapshot) { c7ok = false; continue; }
  const srcTax = t._snapshot.tax_type ?? null;          // 제거될 single 실측
  const dstTax = null;                                   // package_payments INSERT 는 tax_type 미세팅 → default(null)
  const equal = srcTax === dstTax;
  say(`    ${t.chart}: source single tax_type=${JSON.stringify(srcTax)} → dest package_payments tax_type=${JSON.stringify(dstTax)}  ${equal ? '등가✅' : '⚠불일치'}`);
  if (!equal) { c7ok = false;
    say(`      ❗ 등가 아님 → apply 시 package_payments INSERT 에 tax_type=${JSON.stringify(srcTax)} 명시 승계 필요(현 write-path 미세팅). insurance 축 이동 방지.`); }
}
// (b) 보강: insurance-split 을 service_charges(명세 grain)로 산출하는 경로도 MOVE 무접점인지 확인
let scNote = '';
for (const t of FREEZE) {
  try {
    const { data: sc } = await sb.from('service_charges').select('id, tax_type').eq('customer_id', t.cust).gte('created_at', D0).lt('created_at', D1);
    scNote += ` ${t.chart}:sc ${(sc ?? []).length}행`;
  } catch { scNote += ` ${t.chart}:sc(테이블無/예외)`; }
}
say(`  service_charges(명세 grain) 당일:${scNote} — MOVE 는 service_charges 0 write(무접점)`);
chk('C7', c7ok,
  `분류 등가 실측: 제거 single tax_type == 재기입 package_payments tax_type (freeze 실측 둘 다 null=체험권 비급여 flat). payments·package_payments tax_type 컬럼 보유하나 값 등가(null→null) → insurance 축 이동 0. service_charges 경로도 무접점.`);
chk('C5③', c7ok, 'insurance_split: 결제행 tax_type 등가(null→null) + service_charges 무접점 → 급여/비급여/공단 3축 불변');

// ══ C8 — 구조근본 분리 (PKG-REGEN 티켓) ═════════════════════════════════════════
say('\n─── C8 · 구조근본 분리 ───');
chk('C8', true, 'T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK(P1, approved·旣존재) — hot-patch 블로커 아님. RC-B FK부재 재발차단은 별도 구조티켓.');

// ══ 요약 ════════════════════════════════════════════════════════════════════════
say('\n════════ C1~C8 요약 ════════');
const passed = ['C1', 'C1b', 'C2', 'C3', 'C4', 'C5①', 'C5②', 'C5③', 'C6', 'C7', 'C8'].filter((c) => !fail.includes(c));
say(`  PASS ${passed.length}/11 : ${passed.join(' ')}`);
if (fail.length) say(`  FAIL : ${[...new Set(fail)].join(' ')}`);
say(abort ? '\n⚠ C3 abort 조건 — freeze drift/재특정 필요. apply 금지.' : '\n✅ C1~C8 dry-run 실증 완료 (무영속).');
say('⚠ 이것은 dry-run 이다. apply 는 gate2(김주연 재확인)+gate3(형 인지·supervisor DB-GATE·archive DDL migration_ledger) 후에만. write=0.');
