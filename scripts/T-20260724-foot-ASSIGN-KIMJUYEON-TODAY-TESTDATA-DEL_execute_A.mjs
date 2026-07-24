/**
 * T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL — EXECUTE (A) ONLY
 *
 * planner GO (MSG-20260724-214047-n10w):
 *   (A) 박민석(F-4790) 취소 배정 4건 → GO 즉시 실행.
 *   (B) 서류테스트2 FK-closure → HOLD (DA GO + 김주연 scope-확대 confirm 대기). 본 스크립트 미포함.
 *
 * 방식: archive-first, freeze-set(id 명시)로만 DELETE, FK-safe 순서, rows-affected = freeze count 정확 일치 검증.
 * SOP: Cross-CRM Orphan-Row Archive-First Cleanup + FK Integrity Guard.
 *
 * 실행: node scripts/..._execute_A.mjs --execute   (플래그 없으면 verify-only)
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

// .env.local 로드 (SUPABASE_SERVICE_ROLE_KEY)
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const EXECUTE = process.argv.includes('--execute');
const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const JUYEON = '10eacaa8-fa6b-4615-8bf1-02b4f49cb6ed';

// ── FREEZE-SET (id 명시, FREEZE.json A_parkminseok 계승) ──
const FREEZE = {
  check_ins: [
    { id: '9fa4be59-2b48-47f7-beed-561d5483377d', name: '박민석', chart: 'F-4790', status: 'cancelled' },
    { id: '32c1431c-23e9-465b-8575-164f8a763ee3', name: '박민석', chart: 'F-4790', status: 'cancelled' },
    { id: '4c0f40b6-e674-473d-bb48-0f5bb7757ad9', name: '박민석', chart: 'F-4790', status: 'cancelled' },
    { id: '4a406e80-16f4-428e-8f8e-6fa08e0bdc9a', name: '박민석', chart: 'F-4790', status: 'cancelled' },
  ],
  assignment_actions: [
    { id: '13bd2631-a8c1-4596-9264-e5ba923677d7', check_in_id: '9fa4be59-2b48-47f7-beed-561d5483377d', role: 'consult', to: JUYEON },
    { id: '920baee0-fe0a-4413-bebf-183ea00742a8', check_in_id: '32c1431c-23e9-465b-8575-164f8a763ee3', role: 'consult', to: JUYEON },
    { id: '90610d28-62f3-4fb0-9894-45a393bcf911', check_in_id: '4c0f40b6-e674-473d-bb48-0f5bb7757ad9', role: 'consult', to: JUYEON },
    { id: '213e46e4-7455-4596-a2ee-71d27f092634', check_in_id: '4a406e80-16f4-428e-8f8e-6fa08e0bdc9a', role: 'consult', to: JUYEON },
  ],
};
const CI_IDS = FREEZE.check_ins.map((r) => r.id);
const AA_IDS = FREEZE.assignment_actions.map((r) => r.id);
const sorted = (a) => [...a].sort();
const setEq = (a, b) => a.length === b.length && sorted(a).every((v, i) => v === sorted(b)[i]);

const abort = (msg) => { console.error(`\n❌ ABORT: ${msg}\n파괴적 쓰기 미실행. 재검토 필요.`); process.exit(1); };
const evidence = { ticket: 'T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL', part: 'A_parkminseok',
  mode: EXECUTE ? 'EXECUTE' : 'VERIFY-ONLY', freeze_count: { check_ins: 4, assignment_actions: 4 }, steps: [] };

console.log(`=== (A) 박민석 F-4790 취소 배정 삭제 — ${EXECUTE ? 'EXECUTE' : 'VERIFY-ONLY (dry)'} ===\n`);

// ── STEP 1: freeze-set 재검증 (live DB 대조) ──
const { data: liveCi, error: e1 } = await supabase.from('check_ins')
  .select('id, customer_name, status, visit_type, checked_in_at, clinic_id, customers(chart_number)').in('id', CI_IDS);
if (e1) abort(`check_ins 조회 실패: ${e1.message}`);
if ((liveCi ?? []).length !== 4) abort(`freeze check_ins 4건 중 live ${liveCi?.length ?? 0}건 (drift/이미 삭제됨)`);
for (const r of liveCi) {
  const f = FREEZE.check_ins.find((x) => x.id === r.id);
  if (r.customer_name !== f.name) abort(`check_in ${r.id} name drift: live=${r.customer_name} freeze=${f.name}`);
  if (r.status !== f.status) abort(`check_in ${r.id} status drift: live=${r.status} freeze=${f.status} (취소건 아님)`);
  if (r.customers?.chart_number !== f.chart) abort(`check_in ${r.id} chart drift: live=${r.customers?.chart_number} freeze=${f.chart}`);
  if (r.clinic_id !== CLINIC) abort(`check_in ${r.id} clinic drift`);
}
console.log('✅ STEP1 freeze check_ins 4/4 일치 (박민석 F-4790 전부 cancelled, clinic 일치)');
evidence.steps.push({ step: 'freeze_recheck_check_ins', matched: liveCi.length, ok: true });

// ── STEP 2: assignment_actions 재검증 (A_CI 소속 = frozen 4건 정확 일치, drift 시 abort) ──
const { data: liveAaByCi, error: e2 } = await supabase.from('assignment_actions').select('*').in('check_in_id', CI_IDS);
if (e2) abort(`assignment_actions 조회 실패: ${e2.message}`);
const liveAaIds = (liveAaByCi ?? []).map((r) => r.id);
if (!setEq(liveAaIds, AA_IDS)) abort(`assignment_actions drift: live=[${sorted(liveAaIds)}] freeze=[${sorted(AA_IDS)}]`);
for (const r of liveAaByCi) if (r.to_staff_id !== JUYEON) abort(`aa ${r.id} to_staff drift (김주연 아님): ${r.to_staff_id}`);
console.log('✅ STEP2 assignment_actions 4/4 일치 (전부 →김주연, freeze-set 외 신규 자식 없음)');
evidence.steps.push({ step: 'freeze_recheck_assignment_actions', matched: liveAaIds.length, ok: true });

// ── STEP 3: FK 자식 footprint 전수 probe (ledger clean 재확인 + 미상 자식 탐지) ──
const childTables = ['payments', 'service_charges', 'package_sessions'];
const childCounts = {};
for (const t of childTables) {
  const { data, error } = await supabase.from(t).select('id').in('check_in_id', CI_IDS);
  if (error) abort(`${t} probe 실패: ${error.message}`);
  childCounts[t] = (data ?? []).length;
}
console.log(`   child footprint: ${JSON.stringify(childCounts)}`);
if (childCounts.payments || childCounts.service_charges || childCounts.package_sessions)
  abort(`(A) check_in 에 예상밖 ledger 자식 발견: ${JSON.stringify(childCounts)} — 매출/패키지 접점, dev 임의 삭제 금지`);
console.log('✅ STEP3 ledger 무접점 재확인 (payments/service_charges/package_sessions = 0) → 원장 clean');
evidence.steps.push({ step: 'fk_child_footprint_probe', counts: childCounts, ok: true });

// ── STEP 4: archive-first — 삭제 직전 live 원값 스냅샷 (복구경로) ──
const { data: arCi } = await supabase.from('check_ins').select('*').in('id', CI_IDS);
const { data: arAa } = await supabase.from('assignment_actions').select('*').in('id', AA_IDS);
const executedArchive = { ticket: evidence.ticket, part: 'A_parkminseok',
  snapshot_at_kst: '2026-07-24', note: '삭제 직전 live 원값 (복구경로). archive-first per Orphan-Row Cleanup SOP.',
  check_ins: arCi ?? [], assignment_actions: arAa ?? [] };
writeFileSync(new URL('./T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL_EXEC_ARCHIVE_A.json', import.meta.url),
  JSON.stringify(executedArchive, null, 2));
console.log('✅ STEP4 archive-first 스냅샷 기록: _EXEC_ARCHIVE_A.json');
evidence.steps.push({ step: 'archive_first', check_ins: (arCi ?? []).length, assignment_actions: (arAa ?? []).length, ok: true });

if (!EXECUTE) {
  console.log('\n🟡 VERIFY-ONLY 완료 (WRITE 0). --execute 플래그로 실제 삭제.');
  writeFileSync(new URL('./T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL_EXEC_EVIDENCE_A.json', import.meta.url),
    JSON.stringify(evidence, null, 2));
  process.exit(0);
}

// ── STEP 5: DELETE assignment_actions (FK-safe: 자식 먼저) — freeze id 명시, rows-affected 검증 ──
const { data: delAa, error: eDelAa } = await supabase.from('assignment_actions').delete().in('id', AA_IDS).select('id');
if (eDelAa) abort(`assignment_actions DELETE 실패: ${eDelAa.message}`);
const nAa = (delAa ?? []).length;
if (nAa !== 4) abort(`assignment_actions rows-affected ${nAa} ≠ freeze 4 — 즉시 중단, 정합 붕괴`);
console.log(`✅ STEP5 assignment_actions DELETE: rows-affected ${nAa}/4 일치`);
evidence.steps.push({ step: 'delete_assignment_actions', rows_affected: nAa, expected: 4, ok: true, deleted_ids: (delAa ?? []).map((r) => r.id) });

// ── STEP 6: DELETE check_ins (부모) — freeze id 명시, rows-affected 검증 ──
const { data: delCi, error: eDelCi } = await supabase.from('check_ins').delete().in('id', CI_IDS).select('id');
if (eDelCi) abort(`check_ins DELETE 실패: ${eDelCi.message} — assignment_actions 는 이미 삭제됨, archive 로 복구 가능`);
const nCi = (delCi ?? []).length;
if (nCi !== 4) abort(`check_ins rows-affected ${nCi} ≠ freeze 4`);
console.log(`✅ STEP6 check_ins DELETE: rows-affected ${nCi}/4 일치`);
evidence.steps.push({ step: 'delete_check_ins', rows_affected: nCi, expected: 4, ok: true, deleted_ids: (delCi ?? []).map((r) => r.id) });

// ── STEP 7: post-verify — 잔존 0 확인 ──
const { data: postCi } = await supabase.from('check_ins').select('id').in('id', CI_IDS);
const { data: postAa } = await supabase.from('assignment_actions').select('id').in('id', AA_IDS);
if ((postCi ?? []).length !== 0) abort(`post-verify: check_ins 잔존 ${postCi.length}`);
if ((postAa ?? []).length !== 0) abort(`post-verify: assignment_actions 잔존 ${postAa.length}`);
console.log('✅ STEP7 post-verify: check_ins 0, assignment_actions 0 잔존 — 완전 삭제 확인');
evidence.steps.push({ step: 'post_verify_zero_residual', check_ins: 0, assignment_actions: 0, ok: true });

evidence.result = { status: 'DONE', total_deleted: nAa + nCi, check_ins_deleted: nCi, assignment_actions_deleted: nAa };
writeFileSync(new URL('./T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL_EXEC_EVIDENCE_A.json', import.meta.url),
  JSON.stringify(evidence, null, 2));
console.log(`\n🟢 (A) 완료 — 총 ${nAa + nCi}건 삭제 (check_ins 4 + assignment_actions 4). (B) 서류테스트2 미실행 (HOLD 유지).`);
