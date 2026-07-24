/**
 * T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL — RE-DRY-RUN + FREEZE + ARCHIVE (READ-ONLY, WRITE 0)
 *
 * 재개 근거: 김주연 총괄 회신 확정(thread reply_ts=1784890087.134809). AC-2 sanity 3문 답변으로 삭제 스코프 확정.
 *
 * ■ 확정 삭제 스코프 (planner NEW-TASK MSG-20260724-211859-as1s)
 *   (A) 박민석 고객 '취소' 상태 배정 4건 → 삭제
 *   (B) 서류테스트2 '완료(done)' 건 + 연결 payments 4건(합계 35,200원) → 결제까지 함께 삭제
 * ■ 제외(삭제 금지 / KEEP)
 *   (C) 타상담사(김지윤·강경민)에게 인계된 기록 → 정상 담당자변경 audit → 대상에서 명시 제외
 *
 * ■ 이 스크립트 = STEP 1: 아침 stale 스냅샷 폐기 → 신규 re-dry-run. SELECT-only.
 *   1) 김주연 today(KST 2026-07-24) 전체 배정면(check_ins consultant=김주연 + assignment_actions from/to 김주연) 전수 DUMP
 *   2) (A)(B)(C) 자동 분류 + payments 연결 확인
 *   3) freeze-set = (A)+(B) 삭제대상 PK 명시 열거 (data_correction_backfill_sop: count 삭제 금지)
 *   4) archive-first: freeze 대상 전체 원값 before-snapshot export (순소실0 복구경로)
 *   5) abort 가드: (C) disjoint / 다른날짜 무접점 / payments 4건·35,200원 정합 / done·cancelled 상태 정합
 *   출력: _FREEZE.json (freeze셋+원값) + _ARCHIVE.json (before-snapshot) + _DRYRUN_REPORT.md
 *   ★ WRITE 0 — planner 승인 게이트 전까지 hard-DELETE 미실행.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC_SLUG = 'jongno-foot';
const DATE_KST = '2026-07-24';
const GTE = `${DATE_KST}T00:00:00+09:00`;
const LTE = `${DATE_KST}T23:59:59.999+09:00`;
const JUYEON_NAME = '김주연';
const KEEP_NAMES = ['김지윤', '강경민']; // (C) 인계 대상 상담사 — 삭제 금지
const TARGET_A_CUST = '박민석';   // 취소 상태 배정
const TARGET_B_CUST = '서류테스트2'; // 완료건 + payments
const EXPECT_PAY_COUNT = 4;
const EXPECT_PAY_SUM = 35200;

const out = {
  ticket: 'T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL',
  mode: 'READ-ONLY re-dry-run (WRITE 0)', date_kst: DATE_KST, kst_boundary: { gte: GTE, lte: LTE },
  clinic: null, staff: {}, dump: { check_ins: [], assignment_actions: [], payments: [] },
  classify: { A_parkminseok_cancelled: [], B_seoryu_done: [], B_payments: [], C_keep_handover: [], other: [] },
  freeze: { check_in_ids: [], assignment_action_ids: [], payment_ids: [] },
  abort: [], notes: [],
};

// 1) clinic
const { data: clinic, error: ce } = await supabase.from('clinics').select('id, name, slug').eq('slug', CLINIC_SLUG).single();
if (ce || !clinic) { console.error('clinics 조회 실패', ce?.message); process.exit(1); }
out.clinic = clinic;
console.log(`clinic: ${clinic.name} (${clinic.id})\n`);

// 2) staff 해석 (김주연 / 김지윤 / 강경민)
const { data: staffRows, error: se } = await supabase.from('staff').select('id, name, role, active, user_id').eq('clinic_id', clinic.id);
if (se) { console.error('staff 조회 실패', se.message); process.exit(1); }
const byName = (nm) => (staffRows ?? []).filter((s) => (s.name ?? '').trim() === nm);
const juyeon = byName(JUYEON_NAME);
if (juyeon.length !== 1) out.abort.push(`김주연 staff 매치 ${juyeon.length}건 (기대 1)`);
const juyeonId = juyeon[0]?.id ?? null;
out.staff.juyeon = juyeon;
out.staff.keep = {};
const keepIds = new Set();
for (const nm of KEEP_NAMES) {
  const m = byName(nm);
  out.staff.keep[nm] = m;
  m.forEach((s) => keepIds.add(s.id));
}
console.log(`김주연 staff: ${juyeon.map((s) => `${s.id}(role=${s.role},active=${s.active})`).join(' , ') || '(없음)'}`);
console.log(`(C) KEEP 상담사 ids:`, [...keepIds].join(',') || '(없음)');

// 3) DUMP — check_ins (consultant=김주연, today KST)
const { data: cis, error: e1 } = await supabase
  .from('check_ins')
  .select('id, customer_id, customer_name, consultant_id, therapist_id, status, visit_type, checked_in_at, created_date, clinic_id, customers(name, chart_number)')
  .eq('clinic_id', clinic.id)
  .eq('consultant_id', juyeonId)
  .gte('checked_in_at', GTE).lte('checked_in_at', LTE);
if (e1) { console.error('check_ins 조회 실패', e1.message); process.exit(1); }
out.dump.check_ins = cis ?? [];
console.log(`\n── check_ins (consultant=김주연, ${DATE_KST}): ${(cis ?? []).length}건`);
for (const r of (cis ?? [])) {
  console.log(`   ci=${r.id} cust=${r.customer_name}(${r.customer_id}) chart=${r.customers?.chart_number ?? '-'} status=${r.status} vt=${r.visit_type} at=${r.checked_in_at}`);
}

// 4) DUMP — assignment_actions (from/to 김주연, today KST)
const { data: aaFrom } = await supabase.from('assignment_actions')
  .select('id, check_in_id, action_type, role, axis, from_staff_id, to_staff_id, reason, created_by, created_at')
  .eq('clinic_id', clinic.id).eq('from_staff_id', juyeonId).gte('created_at', GTE).lte('created_at', LTE);
const { data: aaTo } = await supabase.from('assignment_actions')
  .select('id, check_in_id, action_type, role, axis, from_staff_id, to_staff_id, reason, created_by, created_at')
  .eq('clinic_id', clinic.id).eq('to_staff_id', juyeonId).gte('created_at', GTE).lte('created_at', LTE);
const aaMap = new Map();
[...(aaFrom ?? []), ...(aaTo ?? [])].forEach((a) => aaMap.set(a.id, a));
const aa = [...aaMap.values()];
out.dump.assignment_actions = aa;
console.log(`\n── assignment_actions (from/to 김주연, ${DATE_KST}): ${aa.length}건`);
// check_in_id → customer_name 매핑(분류용)
const ciById = new Map((cis ?? []).map((r) => [r.id, r]));
// assignment_actions 가 참조하는 check_in 중 dump 밖의 것도 이름 확인
const extraCiIds = [...new Set(aa.map((a) => a.check_in_id).filter((id) => id && !ciById.has(id)))];
if (extraCiIds.length) {
  const { data: extraCis } = await supabase.from('check_ins')
    .select('id, customer_name, customer_id, status, checked_in_at, consultant_id').in('id', extraCiIds);
  (extraCis ?? []).forEach((r) => ciById.set(r.id, r));
}
for (const a of aa) {
  const ci = ciById.get(a.check_in_id);
  console.log(`   aa=${a.id} ci=${a.check_in_id}[${ci?.customer_name ?? '?'}] type=${a.action_type} role=${a.role} from=${a.from_staff_id} to=${a.to_staff_id} at=${a.created_at}`);
}

// 5) payments — 이 check_in 들에 연결된 원장 (특히 서류테스트2)
const allCiIds = [...new Set([...(cis ?? []).map((r) => r.id), ...aa.map((a) => a.check_in_id).filter(Boolean)])];
let pays = [];
if (allCiIds.length) {
  const { data: pRows, error: pe } = await supabase.from('payments')
    .select('id, check_in_id, customer_id, amount, method, payment_type, tax_type, created_at')
    .in('check_in_id', allCiIds);
  if (pe) { out.abort.push(`payments 조회 실패: ${pe.message}`); } else { pays = pRows ?? []; }
}
out.dump.payments = pays;
console.log(`\n── payments (연결 check_in ${allCiIds.length}개 기준): ${pays.length}건`);
for (const p of pays) {
  const ci = ciById.get(p.check_in_id);
  console.log(`   pay=${p.id} ci=${p.check_in_id}[${ci?.customer_name ?? '?'}] amount=${p.amount} method=${p.method} type=${p.payment_type} at=${p.created_at}`);
}

// 6) 분류
const nameOfCi = (id) => ciById.get(id)?.customer_name ?? null;
// (A) 박민석 취소 배정: check_ins(박민석, status in 취소류) + 그 check_in 참조 assignment_actions
const cancelStatuses = ['cancelled', 'canceled', 'cancel', '취소'];
const isCancel = (s) => s != null && cancelStatuses.includes(String(s).toLowerCase());
const parkCis = (cis ?? []).filter((r) => (r.customer_name ?? '').trim() === TARGET_A_CUST);
const parkCancelCis = parkCis.filter((r) => isCancel(r.status));
// (B) 서류테스트2 완료(done)
const seoryuCis = (cis ?? []).filter((r) => (r.customer_name ?? '').trim() === TARGET_B_CUST);
const seoryuDoneCis = seoryuCis.filter((r) => String(r.status).toLowerCase() === 'done' || r.status === '완료');
const seoryuCiIds = new Set(seoryuDoneCis.map((r) => r.id));
const seoryuPays = pays.filter((p) => seoryuCiIds.has(p.check_in_id));

// assignment_actions 분류
for (const a of aa) {
  const nm = (nameOfCi(a.check_in_id) ?? '').trim();
  const touchesKeep = keepIds.has(a.to_staff_id) || keepIds.has(a.from_staff_id);
  if (nm === TARGET_A_CUST) {
    // 박민석 관련 배정 액션 → (A) 후보. 단 KEEP 상담사(C)로의 인계면 제외.
    if (touchesKeep) out.classify.C_keep_handover.push({ kind: 'assignment_action', ...a, cust: nm, reason_keep: 'to/from 김지윤·강경민 인계' });
    else out.classify.A_parkminseok_cancelled.push({ kind: 'assignment_action', ...a, cust: nm });
  } else if (nm === TARGET_B_CUST) {
    if (touchesKeep) out.classify.C_keep_handover.push({ kind: 'assignment_action', ...a, cust: nm, reason_keep: 'to/from 김지윤·강경민 인계' });
    else out.classify.B_seoryu_done.push({ kind: 'assignment_action', ...a, cust: nm });
  } else if (touchesKeep) {
    out.classify.C_keep_handover.push({ kind: 'assignment_action', ...a, cust: nm, reason_keep: 'to/from 김지윤·강경민 인계' });
  } else {
    out.classify.other.push({ kind: 'assignment_action', ...a, cust: nm });
  }
}
// check_ins 분류 (A cancelled / B done)
parkCancelCis.forEach((r) => out.classify.A_parkminseok_cancelled.push({ kind: 'check_in', id: r.id, cust: r.customer_name, status: r.status, at: r.checked_in_at }));
seoryuDoneCis.forEach((r) => out.classify.B_seoryu_done.push({ kind: 'check_in', id: r.id, cust: r.customer_name, status: r.status, at: r.checked_in_at }));
seoryuPays.forEach((p) => out.classify.B_payments.push({ kind: 'payment', id: p.id, check_in_id: p.check_in_id, amount: p.amount, method: p.method }));

// 관찰: 박민석 non-cancel check_ins / 서류테스트2 non-done → 분류 밖(삭제 대상 아님)
parkCis.filter((r) => !isCancel(r.status)).forEach((r) => out.classify.other.push({ kind: 'check_in', id: r.id, cust: r.customer_name, status: r.status, note: '박민석 비-취소 → 삭제대상 아님' }));

// 7) freeze-set (A)+(B) 삭제 대상 PK
out.freeze.check_in_ids = [
  ...parkCancelCis.map((r) => r.id),
  ...seoryuDoneCis.map((r) => r.id),
];
out.freeze.assignment_action_ids = [
  ...out.classify.A_parkminseok_cancelled.filter((x) => x.kind === 'assignment_action').map((x) => x.id),
  ...out.classify.B_seoryu_done.filter((x) => x.kind === 'assignment_action').map((x) => x.id),
];
out.freeze.payment_ids = seoryuPays.map((p) => p.id);

// 8) ABORT 가드
const paySum = seoryuPays.reduce((s, p) => s + (p.amount ?? 0), 0);
console.log(`\n\n════ 분류 요약 ════`);
console.log(`(A) 박민석 취소: check_ins ${parkCancelCis.length} + assignment_actions ${out.classify.A_parkminseok_cancelled.filter((x)=>x.kind==='assignment_action').length}`);
console.log(`(B) 서류테스트2 완료: check_ins ${seoryuDoneCis.length} + assignment_actions ${out.classify.B_seoryu_done.filter((x)=>x.kind==='assignment_action').length} + payments ${seoryuPays.length}(합계 ${paySum}원)`);
console.log(`(C) KEEP 인계(김지윤·강경민): ${out.classify.C_keep_handover.length}건 (삭제 금지)`);
console.log(`(기타/관찰): ${out.classify.other.length}건`);

// payments 정합
if (seoryuPays.length !== EXPECT_PAY_COUNT) out.abort.push(`(B) payments ${seoryuPays.length}건 ≠ 기대 ${EXPECT_PAY_COUNT}건`);
if (paySum !== EXPECT_PAY_SUM) out.abort.push(`(B) payments 합계 ${paySum}원 ≠ 기대 ${EXPECT_PAY_SUM}원`);
// (A) 취소 4건 정합 (배정=assignment_actions 줄 기준. check_in+aa 합산이 스코프.)
const aCount = out.freeze.check_in_ids.filter((id) => parkCancelCis.some((r)=>r.id===id)).length + out.classify.A_parkminseok_cancelled.filter((x)=>x.kind==='assignment_action').length;
out.notes.push(`(A) 삭제대상 배정 줄 합계=${aCount} (총괄 지시 '박민석 취소 4건' 과 대조 필요)`);
// (C) disjoint — freeze 셋에 KEEP 상담사 인계 액션 섞이면 abort
const freezeAaIds = new Set(out.freeze.assignment_action_ids);
const cInFreeze = out.classify.C_keep_handover.filter((c) => c.kind === 'assignment_action' && freezeAaIds.has(c.id));
if (cInFreeze.length) out.abort.push(`(C) KEEP 인계기록 ${cInFreeze.length}건이 freeze-set 에 혼입 — disjoint 위반`);
// 다른 날짜 무접점 — dump 는 KST today 로만 조회했으므로 구조적 보장. 재확인:
const allFrozenCi = [...new Set(out.freeze.check_in_ids)];
const offDate = (cis ?? []).filter((r) => allFrozenCi.includes(r.id))
  .filter((r) => { const d = new Date(r.checked_in_at); const kst = new Date(d.getTime() + 9*3600*1000); return kst.toISOString().slice(0,10) !== DATE_KST; });
if (offDate.length) out.abort.push(`freeze check_in 중 ${DATE_KST} 아닌 날짜 ${offDate.length}건`);

// 9) ARCHIVE-first (before-snapshot) — freeze 대상 원값 전체 export
const archive = { ticket: out.ticket, exported_at_note: 'read-only before-snapshot (KST 기록은 파일 mtime 참조)',
  check_ins: (cis ?? []).filter((r) => allFrozenCi.includes(r.id)),
  assignment_actions: aa.filter((a) => freezeAaIds.has(a.id)),
  payments: seoryuPays,
};

// 10) 결론
console.log(`\n════ ABORT 가드 ════`);
if (out.abort.length === 0) console.log('✅ abort 조건 없음 — freeze 확정, planner 승인 대기');
else { console.log('⛔ ABORT — planner FOLLOWUP 필요:'); out.abort.forEach((a) => console.log(`   · ${a}`)); }

const base = new URL('.', import.meta.url).pathname;
writeFileSync(base + 'T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL_FREEZE.json', JSON.stringify(out, null, 2));
writeFileSync(base + 'T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL_ARCHIVE.json', JSON.stringify(archive, null, 2));
console.log(`\nfreeze/archive 스냅샷 저장 완료.`);
console.log(`FREEZE check_in_ids=${out.freeze.check_in_ids.length} assignment_action_ids=${out.freeze.assignment_action_ids.length} payment_ids=${out.freeze.payment_ids.length}`);
process.exit(out.abort.length === 0 ? 0 : 2);
