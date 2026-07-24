/**
 * T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE — FREEZE v2 (READ-ONLY)
 * 재정의 A확정: 고객 백범석의 담당 실장 정연주(c851fbb1) → 강경민.
 * - 강경민 staff 단건 조회 abort 가드 (0 or 다건 → consultant_lookup_fail)
 * - 대상 PK 625e534d 현재 상태 freeze + 원값 스냅샷
 * SELECT-only. UPDATE는 apply 스크립트에서.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const TARGET_PK = '625e534d-22e6-4526-8ea5-c34645691b67';
const EXPECT_CURRENT_CONSULTANT = 'c851fbb1'; // 정연주 (id prefix)
const KKM_NAME = '강경민';

const out = { ticket: 'T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE', ts: null, abort: false, abort_reason: null };

// ── 1) 강경민 staff 단건 조회 (abort 가드) ──
console.log('=== 1) 강경민 staff 조회 (단건 abort 가드) ===');
const { data: kkm, error: kkmErr } = await supabase.from('staff')
  .select('id, name, role, active, clinic_id, user_id').eq('name', KKM_NAME);
if (kkmErr) { console.error('staff query error', kkmErr); process.exit(2); }
const kkmClinic = (kkm ?? []).filter((s) => s.clinic_id === CLINIC);
console.log(`  전체 '강경민' 정확매치: ${(kkm ?? []).length}건`, (kkm ?? []).map((s) => `${s.name}/${s.role}/clinic=${s.clinic_id?.slice(0,8)}/active=${s.active}/id=${s.id}`).join(' | '));
console.log(`  clinic(foot) 한정: ${kkmClinic.length}건`);
out.kkm_matches_all = (kkm ?? []).length;
out.kkm_matches_clinic = kkmClinic.length;
out.kkm_candidates = (kkm ?? []).map((s) => ({ id: s.id, name: s.name, role: s.role, active: s.active, clinic_id: s.clinic_id }));

if (kkmClinic.length !== 1) {
  out.abort = true;
  out.abort_reason = `consultant_lookup_fail: 강경민 clinic 매치 ${kkmClinic.length}건 (기대 1)`;
  console.log(`\n⛔ ABORT: ${out.abort_reason}`);
  writeFileSync(new URL('./T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE_FREEZE2.json', import.meta.url), JSON.stringify(out, null, 2));
  process.exit(3);
}
const KKM_ID = kkmClinic[0].id;
out.kkm_id = KKM_ID;
console.log(`  ✓ 강경민 단건 확정: id=${KKM_ID} role=${kkmClinic[0].role} active=${kkmClinic[0].active}`);

// ── 2) 대상 check_in 625e534d freeze ──
console.log('\n=== 2) 대상 check_in 625e534d freeze ===');
const { data: ci, error: ciErr } = await supabase.from('check_ins').select('*').eq('id', TARGET_PK);
if (ciErr) { console.error('check_ins query error', ciErr); process.exit(2); }
if ((ci ?? []).length !== 1) {
  out.abort = true;
  out.abort_reason = `target_pk_not_found: check_in ${TARGET_PK} 매치 ${(ci ?? []).length}건`;
  console.log(`\n⛔ ABORT: ${out.abort_reason}`);
  writeFileSync(new URL('./T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE_FREEZE2.json', import.meta.url), JSON.stringify(out, null, 2));
  process.exit(3);
}
const row = ci[0];
out.target_row_snapshot = {
  id: row.id, customer_id: row.customer_id, customer_name: row.customer_name,
  consultant_id: row.consultant_id, status: row.status, visit_type: row.visit_type,
  checked_in_at: row.checked_in_at, clinic_id: row.clinic_id,
};
console.log('  columns:', Object.keys(row).join(', '));
console.log('  snapshot:', JSON.stringify(out.target_row_snapshot, null, 2));

// 정연주 staff 확인
const { data: jyj } = await supabase.from('staff').select('id, name, role').eq('id', row.consultant_id);
out.current_consultant = (jyj ?? [])[0] ? { id: jyj[0].id, name: jyj[0].name, role: jyj[0].role } : null;
console.log('  현재 consultant:', JSON.stringify(out.current_consultant));

// ── 3) 정합성 검증 ──
console.log('\n=== 3) 정합성 검증 ===');
const checks = {
  pk_match: row.id === TARGET_PK,
  clinic_match: row.clinic_id === CLINIC,
  current_is_jyj: (row.consultant_id ?? '').startsWith(EXPECT_CURRENT_CONSULTANT),
  not_already_kkm: row.consultant_id !== KKM_ID,
  customer_bbs: (row.customer_name ?? '').includes('백범석'),
};
out.precondition_checks = checks;
console.log('  ', JSON.stringify(checks, null, 2));

if (!checks.current_is_jyj && checks.not_already_kkm) {
  out.abort = true;
  out.abort_reason = `precondition_fail: 현재 consultant_id(${row.consultant_id})가 기대값 정연주(${EXPECT_CURRENT_CONSULTANT}*) 아님`;
  console.log(`\n⛔ ABORT: ${out.abort_reason}`);
}
if (!checks.not_already_kkm) {
  out.idempotent_noop = true;
  console.log('\n⚠ 이미 강경민 — 멱등 no-op (UPDATE 불요)');
}

writeFileSync(new URL('./T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE_FREEZE2.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('\n=== 요약 ===');
console.log(`강경민 id: ${out.kkm_id} · 대상 현재 consultant: ${out.current_consultant?.name}(${row.consultant_id}) · abort=${out.abort} · noop=${!!out.idempotent_noop}`);
console.log('FREEZE2.json 저장 완료.');
