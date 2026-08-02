/**
 * T-20260802-foot-PMW-NOPAY-CHECKIN-TRIAGE — PHASE 1 DIAGNOSTIC PROBE (READ-ONLY, prod write 0)
 *
 * 목적 (AC1): class-A(체크인-무수납 잔류) 31건 per-row evidence 진단표 산출.
 *   class-A 정의 = check_ins.status='payment_waiting' ∩ 결제기록 자체가 전무(payments 0행).
 *   → autopromote 술어(reconciled payment 보유)와 직교 — 승격 대상이 원천적으로 아님.
 *   (class-B 3건 = payment 행은 있으나 reconciled 술어 밖 = coverage gap = 별건
 *    T-20260802-foot-RECONCILE-COVERAGEGAP-ROOTCAUSE 트랙. 본 probe에서 분리 카운트만.)
 *
 * 산출: 행별 evidence
 *   check_in id / customer(name·chart·visit_type) / checked_in_at(+KST일·경과일)
 *   / 마지막 status_transition / 예약(reservation) 상태 / payment 부재 확인(linked·sameday 카운트)
 *   / disposition 후보 그룹핑 — (a)완료-수납누락 의심 / (b)취소·노쇼 의심 / (c)판단불가.
 *   ★ 그룹핑은 "판정"이 아니라 "후보 제시". 실제 disposition = Phase2 현장 게이트에서만 확정.
 *
 * ⛔ 절대 가드: 이 스크립트는 오직 SELECT. UPDATE/INSERT/DELETE 0. prod write 0.
 *   blanket UPDATE 금지 — 정정 실행은 Phase3(현장 확정 disposition + Data-Correction Backfill SOP + DA CONSULT).
 *
 * 실행:  node scripts/T-20260802-foot-PMW-NOPAY-CHECKIN-TRIAGE_phase1_probe.mjs
 *   → db-gate/T-20260802-foot-PMW-NOPAY-CHECKIN-TRIAGE_phase1_evidence.json
 *   → db-gate/T-20260802-foot-PMW-NOPAY-CHECKIN-TRIAGE_phase1_evidence.md (현장 제시용 표)
 *
 * 근거: 티켓 frontmatter risk_reason (risk_verdict=BLOCK)
 *       T-20260728-foot-PMW-RECONCILE-AUTOPROMOTE-FORWARDFIX (class-A/B 실측 분해)
 *       agents/docs/data_correction_backfill_sop.md (Phase3 봉투)
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// --- env ---
function envFromLocal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].trim();
    }
  }
  return null;
}
const URL = envFromLocal('VITE_SUPABASE_URL');
const SRK = envFromLocal('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !SRK) { console.error('❌ missing VITE_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(URL, SRK, { auth: { persistSession: false } });

const KST_MS = 9 * 3600 * 1000;
function kstDate(ts) {
  if (!ts) return null;
  return new Date(new Date(ts).getTime() + KST_MS).toISOString().slice(0, 10);
}
function kstTodayStr() {
  return new Date(Date.now() + KST_MS).toISOString().slice(0, 10);
}
function daysBetween(fromDateStr, toDateStr) {
  if (!fromDateStr || !toDateStr) return null;
  const a = new Date(fromDateStr + 'T00:00:00Z').getTime();
  const b = new Date(toDateStr + 'T00:00:00Z').getTime();
  return Math.round((b - a) / (24 * 3600 * 1000));
}
const log = (...a) => console.log(...a);

async function tableColumns(table) {
  const { data, error } = await db.from(table).select('*').limit(1);
  if (error) return { error: error.message, cols: null };
  return { error: null, cols: data && data[0] ? Object.keys(data[0]) : [] };
}

const CANCEL_LIKE = ['cancelled', 'canceled', 'no_show', 'noshow', 'no-show', 'void', 'voided'];
const COMPLETE_LIKE = ['completed', 'done', 'attended', 'finished', 'complete'];
// payment_waiting 직전 stage(from_status)가 실제 시술 단계였는지 = 시술 진행 신호(수납누락 후보 강도).
const TREATMENT_PROGRESSED_STAGES = ['done', 'laser', 'treatment', 'treating', 'preconditioning', 'procedure'];

async function main() {
  const today = kstTodayStr();
  log(`\n=== PMW-NOPAY-CHECKIN-TRIAGE PHASE1 PROBE (READ-ONLY, write 0) — today(KST)=${today} ===`);

  // ── [0] 스키마 introspection ──
  const ci = await tableColumns('check_ins');
  const pay = await tableColumns('payments');
  const rsv = await tableColumns('reservations');
  const st = await tableColumns('status_transitions');
  const CI_HAS_RESV = ci.cols?.includes('reservation_id') ?? false;
  const ST_TIME_COL = ['created_at', 'transitioned_at', 'changed_at'].find((c) => st.cols?.includes(c)) ?? 'created_at';
  const RSV_STATUS_COL = ['status', 'reservation_status', 'state'].find((c) => rsv.cols?.includes(c)) ?? 'status';
  const RSV_TIME_COL = ['reserved_at', 'start_time', 'scheduled_at', 'created_at'].find((c) => rsv.cols?.includes(c)) ?? 'created_at';
  log(`  check_ins cols(${ci.cols?.length}) reservation_id=${CI_HAS_RESV}`);
  log(`  status_transitions time-col=${ST_TIME_COL}; reservations status-col=${RSV_STATUS_COL}`);

  // ── [1] payment_waiting 전수 ──
  const { data: waits, error: wErr } = await db
    .from('check_ins')
    .select('*')
    .eq('status', 'payment_waiting')
    .order('checked_in_at', { ascending: true });
  if (wErr) { console.error('❌ check_ins:', wErr.message); process.exit(1); }
  log(`  payment_waiting 총: ${waits.length}`);

  const out = {
    ticket: 'T-20260802-foot-PMW-NOPAY-CHECKIN-TRIAGE',
    phase: 'phase1-diagnosis-readonly',
    generated_at: new Date().toISOString(),
    kst_today: today,
    risk_verdict: 'BLOCK',
    write_count: 0,
    definitions: {
      class_A: "payment_waiting ∩ payments 0행(결제기록 전무) — 본 티켓 대상(체크인-무수납 잔류)",
      class_B: "payment_waiting ∩ payment 행 有 but reconciled 술어 밖(coverage gap) — 별건 T-20260802-foot-RECONCILE-COVERAGEGAP-ROOTCAUSE",
      reconciled_promotable: "payment_waiting ∩ reconciled positive payment 보유 — AUTOPROMOTE 트랙(FORWARDFIX)",
    },
    counts: { payment_waiting_total: waits.length, class_A: 0, class_B: 0, reconciled_promotable: 0 },
    disposition_candidate_counts: { a_complete_pay_missing: 0, b_cancel_noshow: 0, c_undeterminable: 0 },
    class_A_rows: [],
    class_B_rows_refcount_only: [],
  };

  function isPositivePayment(p) {
    const amt = Number(p.amount ?? p.paid_amount ?? p.total_amount ?? 0);
    const status = (p.status ?? '').toLowerCase();
    if (p.deleted_at) return false;
    if (p.is_simulation === true) return false;
    if (['cancelled', 'canceled', 'void', 'voided', 'refunded', 'refund', 'reversed', 'failed', 'deleted'].includes(status)) return false;
    return amt > 0;
  }

  for (const w of waits) {
    const ciDate = kstDate(w.checked_in_at);
    const custId = w.customer_id;

    // ── payments (전체 행 — 부재 확인용) ──
    const { data: linkedPays } = await db.from('payments').select('*').eq('check_in_id', w.id);
    const linkedCount = (linkedPays ?? []).length;

    // 동일 고객 · 동일자 payments (orphan-pay 포함)
    let sameDayPays = [];
    if (custId && ciDate) {
      const { data: cp } = await db.from('payments').select('*').eq('customer_id', custId);
      sameDayPays = (cp ?? []).filter((p) => kstDate(p.paid_at ?? p.created_at ?? p.accounting_date) === ciDate);
    }
    const sameDayPositive = sameDayPays.filter(isPositivePayment);
    const reconciledPositive = (linkedPays ?? []).filter((p) => p.reconciled_at != null && (p.payment_type ?? 'payment') === 'payment' && Number(p.amount ?? 0) > 0);

    // ── 클래스 분기 ──
    if (reconciledPositive.length > 0) { out.counts.reconciled_promotable++; continue; }
    if (linkedCount > 0) {
      // payment 행은 있으나 reconciled 아님 = class-B (coverage gap), 별건. 참조 카운트만.
      out.counts.class_B++;
      out.class_B_rows_refcount_only.push({ check_in_id: w.id, checked_in_date_kst: ciDate, linked_payment_count: linkedCount });
      continue;
    }

    // ── 여기부터 class-A: linked payment 0행 (결제기록 전무) ──
    out.counts.class_A++;

    // customer 스냅샷
    let cust = null;
    if (custId) {
      const { data: cd } = await db.from('customers').select('id,name,chart_number,visit_type,phone,is_simulation').eq('id', custId).maybeSingle();
      cust = cd ?? null;
    }

    // 마지막 status_transition
    let lastST = null;
    {
      const { data: sts } = await db.from('status_transitions').select('*').eq('check_in_id', w.id).order(ST_TIME_COL, { ascending: false }).limit(1);
      if (sts && sts[0]) lastST = { from_status: sts[0].from_status ?? null, to_status: sts[0].to_status ?? null, at: sts[0][ST_TIME_COL] ?? null };
    }

    // 예약 상태 — check_in.reservation_id 우선, 없으면 동일고객·동일자 예약
    let rsvSnap = null;
    if (CI_HAS_RESV && w.reservation_id) {
      const { data: r } = await db.from('reservations').select('*').eq('id', w.reservation_id).maybeSingle();
      if (r) rsvSnap = { source: 'linked', id: r.id, status: r[RSV_STATUS_COL] ?? null, at: r[RSV_TIME_COL] ?? null };
    }
    if (!rsvSnap && custId && ciDate) {
      const { data: rs } = await db.from('reservations').select('*').eq('customer_id', custId);
      const sameDay = (rs ?? []).filter((r) => kstDate(r[RSV_TIME_COL]) === ciDate);
      if (sameDay.length) rsvSnap = { source: 'sameday_customer', id: sameDay[0].id, status: sameDay[0][RSV_STATUS_COL] ?? null, at: sameDay[0][RSV_TIME_COL] ?? null };
    }
    const rsvStatus = (rsvSnap?.status ?? '').toLowerCase();

    // ── disposition 후보 그룹핑 (판정 아님·제안) ──
    //   신호: 예약상태(rsvStatus) / 마지막 전이 to·from / 동일자 orphan positive payment.
    //   payment_waiting 직전 stage(from_status)가 실제 시술 단계면 = 시술 진행됨 → (a) 수납누락 의심 강도↑.
    const lastFrom = (lastST?.from_status ?? '').toLowerCase();
    const lastTo = (lastST?.to_status ?? '').toLowerCase();
    const treatmentProgressed = TREATMENT_PROGRESSED_STAGES.includes(lastFrom);
    let cand, candReason;
    if (CANCEL_LIKE.includes(rsvStatus) || CANCEL_LIKE.includes(lastTo) || CANCEL_LIKE.includes(lastFrom)) {
      cand = 'b_cancel_noshow';
      candReason = `취소·노쇼 계열 신호(rsv=${rsvStatus || '·'}, 전이=${lastFrom || '?'}→${lastTo || '?'}) → status 미정리 의심`;
    } else if (COMPLETE_LIKE.includes(rsvStatus) && sameDayPositive.length > 0) {
      cand = 'a_complete_pay_missing';
      candReason = `예약 완료계열 + 동일자 orphan positive payment ${sameDayPositive.length}건 → check_in 링크 누락/수납 미연결 의심`;
    } else if (treatmentProgressed || COMPLETE_LIKE.includes(rsvStatus)) {
      cand = 'a_complete_pay_missing';
      candReason = `payment_waiting 직전 stage가 시술 단계(${lastFrom || rsvStatus})=시술 진행 정황이나 결제기록 전무 → 수납 누락 의심 (현장 확인)`;
    } else {
      cand = 'c_undeterminable';
      candReason = `시술진행·완료·취소 신호 부족(rsv=${rsvStatus || 'none'}, 전이=${lastFrom || 'none'}→${lastTo || 'none'}, sameday_pay=${sameDayPays.length}) → 현장 판정 필요`;
    }
    out.disposition_candidate_counts[cand]++;

    out.class_A_rows.push({
      check_in_id: w.id,
      clinic_id: w.clinic_id,
      customer_id: custId,
      customer_name: cust?.name ?? null,
      chart_number: cust?.chart_number ?? null,
      visit_type: cust?.visit_type ?? null,
      is_simulation_customer: cust?.is_simulation ?? null,
      checked_in_at: w.checked_in_at,
      checked_in_date_kst: ciDate,
      elapsed_days: daysBetween(ciDate, today),
      current_status: w.status,
      completed_at_current: w.completed_at ?? null,
      last_status_transition: lastST,
      reservation: rsvSnap,
      linked_payment_count: linkedCount,            // = 0 (class-A 정의)
      sameday_payment_count: sameDayPays.length,
      sameday_positive_payment_count: sameDayPositive.length,
      payment_absence_confirmed: linkedCount === 0,
      disposition_candidate: cand,
      disposition_candidate_reason: candReason,
    });
  }

  // ── 요약 ──
  log('\n════════ 요약 ════════');
  log(`payment_waiting 총            : ${out.counts.payment_waiting_total}`);
  log(`  reconciled_promotable(직교) : ${out.counts.reconciled_promotable}  [AUTOPROMOTE 트랙]`);
  log(`  class-B(coverage gap·별건)  : ${out.counts.class_B}  [COVERAGEGAP-ROOTCAUSE 트랙]`);
  log(`  ▶ class-A(무수납·본 티켓)   : ${out.counts.class_A}`);
  log(`     후보 (a)완료-수납누락 의심 : ${out.disposition_candidate_counts.a_complete_pay_missing}`);
  log(`     후보 (b)취소·노쇼 의심     : ${out.disposition_candidate_counts.b_cancel_noshow}`);
  log(`     후보 (c)판단불가           : ${out.disposition_candidate_counts.c_undeterminable}`);
  log(`  ⛔ write_count               : ${out.write_count} (SELECT-only)`);

  fs.mkdirSync('db-gate', { recursive: true });
  const jsonFile = 'db-gate/T-20260802-foot-PMW-NOPAY-CHECKIN-TRIAGE_phase1_evidence.json';
  fs.writeFileSync(jsonFile, JSON.stringify(out, null, 2));
  log(`\n📄 evidence(json) → ${jsonFile}`);

  // ── 현장 제시용 markdown 표 (Phase2 DECISION-REQUEST 첨부) ──
  const rows = out.class_A_rows.map((r, i) => {
    const nm = r.customer_name ?? '(무명)';
    const ch = r.chart_number ?? '-';
    const st = r.last_status_transition ? `${r.last_status_transition.from_status ?? '?'}→${r.last_status_transition.to_status ?? '?'}` : '-';
    const rv = r.reservation ? (r.reservation.status ?? '-') : '-';
    const grp = { a_complete_pay_missing: 'a·완료수납누락?', b_cancel_noshow: 'b·취소노쇼?', c_undeterminable: 'c·판단불가' }[r.disposition_candidate];
    return `| ${i + 1} | ${nm} | ${ch} | ${r.visit_type ?? '-'} | ${r.checked_in_date_kst} | ${r.elapsed_days}일 | ${st} | ${rv} | ${r.sameday_positive_payment_count} | **${grp}** |`;
  }).join('\n');
  const md = `# T-20260802-foot-PMW-NOPAY-CHECKIN-TRIAGE — Phase1 진단표 (현장 제시용)

- 생성: ${out.generated_at} (KST today=${out.kst_today})
- **class-A(체크인-무수납 잔류) = ${out.counts.class_A}건** — payment_waiting인데 결제기록 전무
- disposition 후보: (a)완료-수납누락 의심 ${out.disposition_candidate_counts.a_complete_pay_missing} / (b)취소·노쇼 의심 ${out.disposition_candidate_counts.b_cancel_noshow} / (c)판단불가 ${out.disposition_candidate_counts.c_undeterminable}
- ⚠️ 아래 그룹은 **후보 제안**입니다. 결제기록이 없어 자동 판정이 불가하여, **행별 정답 disposition(완료/미수/취소/노쇼)은 현장에서만 확정**할 수 있습니다.
- write 0 (진단 전용). 정정 실행(Phase3)은 현장 확정 후 별도 봉투로만 진행합니다.

| # | 고객 | 차트 | 방문 | 체크인일 | 경과 | 마지막 상태전이 | 예약상태 | 동일자결제 | disposition 후보 |
|---|------|------|------|----------|------|------------------|----------|-----------|------------------|
${rows}

## 현장 확인 요청 (Phase2)
각 행에 대해 실제 처리 결과를 알려주세요:
- **완료** — 시술까지 끝났고 수납만 기록 누락된 건
- **미수** — 시술은 됐으나 실제 미수금(대기 정당)
- **취소/노쇼** — 방문이 취소·노쇼로 종료됐어야 하는 건
- **판단불가/기타** — 위로 분류 안 되는 건 (사유 메모)
`;
  const mdFile = 'db-gate/T-20260802-foot-PMW-NOPAY-CHECKIN-TRIAGE_phase1_evidence.md';
  fs.writeFileSync(mdFile, md);
  log(`📄 evidence(md·현장제시용) → ${mdFile}`);
  log('\n✅ Phase1 완료. Phase2 = 현장 disposition 확정(DECISION-REQUEST). Phase3 = per-row 정정(Backfill SOP + DA CONSULT, db_change:true 재스코프).');
}

main().catch((e) => { console.error(e); process.exit(1); });
