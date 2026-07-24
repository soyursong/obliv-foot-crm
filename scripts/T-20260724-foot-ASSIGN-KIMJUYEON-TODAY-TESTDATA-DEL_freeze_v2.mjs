/**
 * T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL — FREEZE v2 (READ-ONLY, WRITE 0)
 * v1 대비: 서류테스트2 check_in 의 완전한 FK 자식 폐포(transitive closure) 포함.
 *   child footprint probe 로 발견: service_charges(2)·package_sessions(1)·assignment_actions(2, therapy 포함)
 *   → planner 명시 스코프('payments 4건')를 초과. FK-safe 삭제엔 필수. 스코프 결정 플래그.
 * 산출: _FREEZE.json (freeze셋+원값) + _ARCHIVE.json (before-snapshot 전체) + _DRYRUN_REPORT.md
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE_KST = '2026-07-24';
const JUYEON = '10eacaa8-fa6b-4615-8bf1-02b4f49cb6ed';
const KEEP_STAFF = { '김지윤': 'c23d4491-cbdc-423d-af33-17c836941f9c', '강경민': '6ab26d9f-fd10-4042-9fd7-076f277be5d4' };

// (A) 박민석 취소 check_ins (F-4790) — 4건, ledger 없음
const A_CI = ['9fa4be59-2b48-47f7-beed-561d5483377d','32c1431c-23e9-465b-8575-164f8a763ee3',
              '4c0f40b6-e674-473d-bb48-0f5bb7757ad9','4a406e80-16f4-428e-8f8e-6fa08e0bdc9a'];
// (B) 서류테스트2 done check_in (F-5113) — 1건 + FK 자식 폐포
const B_CI = ['7f3f8b79-eb3d-45f2-afab-205d52bc4a70'];
const ALL_CI = [...A_CI, ...B_CI];

const out = {
  ticket: 'T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL',
  mode: 'READ-ONLY FREEZE v2 (WRITE 0)', generated_note: '재-dry-run freeze (아침 stale 스냅샷 폐기)',
  scope_confirmed_by: '김주연 총괄 thread reply_ts=1784890087.134809',
  clinic_id: CLINIC, date_kst: DATE_KST, juyeon_staff_id: JUYEON, keep_staff: KEEP_STAFF,
  freeze: {}, archive: {}, ledger_beyond_stated_scope: {}, keep_excluded: {}, abort: [], decision_flags: [],
};

// ── FREEZE: (A) check_ins + assignment_actions ──
const { data: aCis } = await supabase.from('check_ins')
  .select('id, customer_name, status, visit_type, checked_in_at, customers(chart_number)').in('id', A_CI);
const { data: aAa } = await supabase.from('assignment_actions').select('*').in('check_in_id', A_CI);
// (A) check_in 들의 다른 ledger 자식 없음 재확인
const { data: aPay } = await supabase.from('payments').select('id').in('check_in_id', A_CI);
const { data: aSc } = await supabase.from('service_charges').select('id').in('check_in_id', A_CI);
const { data: aPs } = await supabase.from('package_sessions').select('id').in('check_in_id', A_CI);
if ((aPay??[]).length || (aSc??[]).length || (aPs??[]).length)
  out.abort.push(`(A) 박민석 check_in 에 예상밖 ledger: payments ${(aPay??[]).length} service_charges ${(aSc??[]).length} package_sessions ${(aPs??[]).length}`);

// ── FREEZE: (B) 서류테스트2 완전 폐포 ──
const { data: bCi } = await supabase.from('check_ins')
  .select('id, customer_name, status, visit_type, checked_in_at, customers(chart_number)').in('id', B_CI);
const { data: bPay } = await supabase.from('payments').select('*').in('check_in_id', B_CI);
const { data: bSc } = await supabase.from('service_charges').select('*').in('check_in_id', B_CI);
const { data: bPs } = await supabase.from('package_sessions').select('*').in('check_in_id', B_CI);
const { data: bAa } = await supabase.from('assignment_actions').select('*').in('check_in_id', B_CI);
// package_sessions 가 참조하는 package (parent) — 삭제 후 orphan 여부 판단
const pkgIds = [...new Set((bPs??[]).map((r)=>r.package_id).filter(Boolean))];
let pkgs = [], pkgSiblingSessions = {};
if (pkgIds.length) {
  const { data: p } = await supabase.from('packages').select('*').in('id', pkgIds);
  pkgs = p ?? [];
  for (const pid of pkgIds) {
    const { data: sib } = await supabase.from('package_sessions').select('id, check_in_id, session_number, status').eq('package_id', pid);
    pkgSiblingSessions[pid] = sib ?? [];
  }
}
// package_payments (있으면) — 이 package 참조 원장
let pkgPays = [];
if (pkgIds.length) {
  const { data: pp, error: ppe } = await supabase.from('package_payments').select('*').in('package_id', pkgIds);
  if (!ppe) pkgPays = pp ?? [];
}

// ── freeze 셋 조립 ──
out.freeze = {
  A_parkminseok: {
    check_ins: (aCis??[]).map((r)=>({ id:r.id, name:r.customer_name, chart:r.customers?.chart_number, status:r.status, at:r.checked_in_at })),
    assignment_actions: (aAa??[]).map((r)=>({ id:r.id, check_in_id:r.check_in_id, action_type:r.action_type, role:r.role, to:r.to_staff_id })),
  },
  B_seoryutest2: {
    check_ins: (bCi??[]).map((r)=>({ id:r.id, name:r.customer_name, chart:r.customers?.chart_number, status:r.status, at:r.checked_in_at })),
    payments: (bPay??[]).map((r)=>({ id:r.id, amount:r.amount, method:r.method, payment_type:r.payment_type, at:r.created_at })),
    service_charges: (bSc??[]).map((r)=>({ id:r.id, base_amount:r.base_amount, insurance_covered_amount:r.insurance_covered_amount, copayment_amount:r.copayment_amount, is_insurance_covered:r.is_insurance_covered })),
    package_sessions: (bPs??[]).map((r)=>({ id:r.id, package_id:r.package_id, session_number:r.session_number, session_type:r.session_type, status:r.status, unit_price:r.unit_price })),
    assignment_actions: (bAa??[]).map((r)=>({ id:r.id, action_type:r.action_type, role:r.role, to:r.to_staff_id })),
  },
};
out.freeze.pk_summary = {
  check_in_ids: [...A_CI, ...B_CI],
  assignment_action_ids: [...(aAa??[]).map(r=>r.id), ...(bAa??[]).map(r=>r.id)],
  payment_ids: (bPay??[]).map(r=>r.id),
  service_charge_ids: (bSc??[]).map(r=>r.id),
  package_session_ids: (bPs??[]).map(r=>r.id),
  orphan_candidate_package_ids: pkgIds,
};

// ── 스코프 초과(beyond stated) ledger 플래그 ──
out.ledger_beyond_stated_scope = {
  note: 'planner 명시 스코프=payments 4건. 아래는 서류테스트2 완료건(check_in) FK-safe 삭제에 동반 필요하나 명시 열거 안 됨 → 승인 필요.',
  service_charges: out.freeze.B_seoryutest2.service_charges,
  package_sessions: out.freeze.B_seoryutest2.package_sessions,
  extra_assignment_action: (bAa??[]).filter(r=>r.to_staff_id!==JUYEON).map(r=>({id:r.id, role:r.role, to:r.to_staff_id})),
  linked_package: pkgs.map((p)=>({ id:p.id, name:p.package_name, status:p.status, total_amount:p.total_amount, paid_amount:p.paid_amount, memo:p.memo, other_sessions: (pkgSiblingSessions[p.id]||[]).filter(s=>!B_CI.includes(s.check_in_id)).length })),
  package_payments: pkgPays,
};
if ((bSc??[]).length) out.decision_flags.push(`서류테스트2 check_in 에 service_charges ${(bSc??[]).length}건(매출 명세 원장) — payments 외 추가. 완료건 삭제 시 동반 삭제 필요.`);
if ((bPs??[]).length) out.decision_flags.push(`서류테스트2 check_in 에 package_sessions ${(bPs??[]).length}건(패키지 회차) — 연결 package "${pkgs[0]?.package_name}"(memo="${pkgs[0]?.memo}"). 회차 삭제 시 package 는 회차 0 orphan.`);
const orphanPkg = pkgs.filter((p)=>(pkgSiblingSessions[p.id]||[]).filter(s=>!B_CI.includes(s.check_in_id)).length===0);
if (orphanPkg.length) out.decision_flags.push(`package ${orphanPkg.map(p=>`${p.id}("${p.package_name}"/paid_amount=${p.paid_amount})`).join(',')} — 회차 전량이 이 check_in 소속 → 삭제 시 회차0 잔존 package. 함께 삭제할지 결정 필요.`);

// ── (C) KEEP 제외 확인 ──
const keepIds = Object.values(KEEP_STAFF);
const { data: keepAa } = await supabase.from('assignment_actions')
  .select('id, check_in_id, action_type, role, from_staff_id, to_staff_id, created_at')
  .eq('clinic_id', CLINIC).gte('created_at', `${DATE_KST}T00:00:00+09:00`).lte('created_at', `${DATE_KST}T23:59:59.999+09:00`)
  .or(`to_staff_id.in.(${keepIds.join(',')}),from_staff_id.in.(${keepIds.join(',')})`);
out.keep_excluded = {
  note: '(C) 김지윤·강경민 인계/관련 기록 — 정상 담당자변경 audit → 삭제 금지, freeze 셋에서 명시 제외',
  handover_actions: (keepAa??[]).map(r=>({ id:r.id, check_in_id:r.check_in_id, role:r.role, from:r.from_staff_id, to:r.to_staff_id })),
};
// disjoint 검증: KEEP 액션이 freeze assignment_action_ids 에 없어야
const freezeAa = new Set(out.freeze.pk_summary.assignment_action_ids);
const overlap = (keepAa??[]).filter(r=>freezeAa.has(r.id));
if (overlap.length) out.abort.push(`(C) KEEP 액션 ${overlap.length}건이 freeze 에 혼입 — disjoint 위반`);

// ── ARCHIVE (before-snapshot 전체 원값) ──
out.archive = {
  check_ins: [...(aCis??[]), ...(bCi??[])],
  assignment_actions: [...(aAa??[]), ...(bAa??[])],
  payments: bPay ?? [], service_charges: bSc ?? [], package_sessions: bPs ?? [],
  packages_linked: pkgs, package_payments: pkgPays,
};

// ── 정합 가드 ──
const paySum = (bPay??[]).reduce((s,p)=>s+(p.amount??0),0);
if ((bPay??[]).length !== 4) out.abort.push(`payments ${(bPay??[]).length} ≠ 4`);
if (paySum !== 35200) out.abort.push(`payments 합계 ${paySum} ≠ 35200`);
if ((aCis??[]).length !== 4) out.abort.push(`박민석 check_in ${(aCis??[]).length} ≠ 4`);
if (!(aCis??[]).every(r=>String(r.status).toLowerCase()==='cancelled')) out.abort.push('박민석 check_in 중 cancelled 아닌 건 존재');
if ((bCi??[]).length !== 1 || String(bCi[0].status).toLowerCase()!=='done') out.abort.push('서류테스트2 done check_in 정합 실패');

// ── 출력 ──
const base = new URL('.', import.meta.url).pathname;
writeFileSync(base + 'T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL_FREEZE.json', JSON.stringify(out, null, 2));
writeFileSync(base + 'T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL_ARCHIVE.json', JSON.stringify(out.archive, null, 2));

console.log('════ FREEZE v2 요약 ════');
console.log(`(A) 박민석 취소: check_ins ${(aCis??[]).length} + assignment_actions ${(aAa??[]).length} (ledger 없음)`);
console.log(`(B) 서류테스트2 완료: check_ins ${(bCi??[]).length} + payments ${(bPay??[]).length}(${paySum}원) + service_charges ${(bSc??[]).length} + package_sessions ${(bPs??[]).length} + assignment_actions ${(bAa??[]).length}`);
console.log(`(C) KEEP 제외: ${(keepAa??[]).length}건`);
console.log(`\n★ 스코프 결정 필요 플래그:`);
out.decision_flags.forEach(f=>console.log(`   · ${f}`));
console.log(`\nABORT: ${out.abort.length===0?'없음 ✅':''}`);
out.abort.forEach(a=>console.log(`   ⛔ ${a}`));
console.log(`\nFK-safe 삭제 순서(제안): payments → service_charges → package_sessions → assignment_actions → check_ins [→ orphan package?]`);
process.exit(out.abort.length===0?0:2);
