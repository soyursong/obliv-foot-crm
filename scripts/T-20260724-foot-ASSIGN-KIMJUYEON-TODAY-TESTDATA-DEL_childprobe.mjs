/**
 * T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL — CHILD FOOTPRINT PROBE (READ-ONLY)
 * freeze 대상 check_in 5건이 참조되는 모든 자식 테이블을 전수 조사 → FK-safe 삭제 순서 확정 + orphan 방지.
 * (Cross-CRM Orphan-Row Archive-First + FK Integrity Guard SOP)
 */
import { createClient } from '@supabase/supabase-js';
const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const FROZEN_CI = [
  '9fa4be59-2b48-47f7-beed-561d5483377d', // 박민석 cancelled
  '32c1431c-23e9-465b-8575-164f8a763ee3', // 박민석 cancelled
  '4c0f40b6-e674-473d-bb48-0f5bb7757ad9', // 박민석 cancelled
  '4a406e80-16f4-428e-8f8e-6fa08e0bdc9a', // 박민석 cancelled
  '7f3f8b79-eb3d-45f2-afab-205d52bc4a70', // 서류테스트2 done
];

// check_in_id 로 연결될 가능성 있는 자식 테이블 후보 (foot 스키마)
const CHILD_TABLES = [
  'payments', 'assignment_actions', 'service_charges', 'treatments', 'treatment_records',
  'package_payments', 'package_sessions', 'medical_charts', 'consents', 'consent_forms',
  'documents', 'prescriptions', 'check_in_treatments', 'chart_entries', 'medical_records',
  'reservations', 'billing_items', 'receipts',
];

console.log('freeze check_in 5건의 자식 테이블 전수 조사 (READ-ONLY)\n');
for (const t of CHILD_TABLES) {
  const { data, error } = await supabase.from(t).select('id, check_in_id').in('check_in_id', FROZEN_CI);
  if (error) {
    if (/does not exist|column .* does not exist|schema cache/i.test(error.message)) {
      console.log(`  ${t.padEnd(22)} : (테이블/컬럼 없음 — skip) ${error.message.slice(0,60)}`);
    } else {
      console.log(`  ${t.padEnd(22)} : ⚠ 조회오류 ${error.message.slice(0,70)}`);
    }
    continue;
  }
  const n = (data ?? []).length;
  const flag = n > 0 ? ' ★' : '';
  console.log(`  ${t.padEnd(22)} : ${n}건${flag}`);
  if (n > 0) {
    const byCi = {};
    (data ?? []).forEach((r) => { byCi[r.check_in_id] = (byCi[r.check_in_id]||0)+1; });
    Object.entries(byCi).forEach(([ci,c]) => console.log(`       ${ci}: ${c}`));
  }
}
console.log('\n조사 완료. ★ 표시 테이블 = FK-safe 삭제 시 check_in 前 먼저 삭제 필요.');
