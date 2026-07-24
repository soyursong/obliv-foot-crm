/**
 * T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE — APPLY
 * 고객 백범석 담당 실장 정연주(c851fbb1) → 강경민(6ab26d9f) : check_ins.consultant_id UPDATE.
 * 명시-PK 단일행. cross_crm_write_rowcheck_standard: rows-affected==1 검증 + POSTCHECK.
 * DRY-RUN: node ... (기본, WRITE0) / APPLY: APPLY=1 node ...
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TARGET_PK = '625e534d-22e6-4526-8ea5-c34645691b67';
const OLD_CONSULTANT = 'c851fbb1-31ce-4714-b91c-03e9cb8af566'; // 정연주 (freeze 원값)
const NEW_CONSULTANT = '6ab26d9f-fd10-4042-9fd7-076f277be5d4'; // 강경민 (freeze 단건 확정)
const APPLY = process.env.APPLY === '1';

// PRECHECK: 원값 재확인 (동시성/멱등 가드)
const { data: pre } = await supabase.from('check_ins')
  .select('id, customer_name, consultant_id').eq('id', TARGET_PK);
if ((pre ?? []).length !== 1) { console.error(`⛔ ABORT: target ${TARGET_PK} 매치 ${(pre ?? []).length}`); process.exit(3); }
console.log('PRECHECK:', JSON.stringify(pre[0]));
if (pre[0].consultant_id === NEW_CONSULTANT) { console.log('⚠ 이미 강경민 — 멱등 no-op. 종료.'); process.exit(0); }
if (pre[0].consultant_id !== OLD_CONSULTANT) { console.error(`⛔ ABORT: 현재 consultant(${pre[0].consultant_id}) ≠ freeze 원값(${OLD_CONSULTANT})`); process.exit(3); }

if (!APPLY) {
  console.log('\n[DRY-RUN] WRITE0. 예정 SQL:');
  console.log(`  UPDATE check_ins SET consultant_id='${NEW_CONSULTANT}' WHERE id='${TARGET_PK}' AND consultant_id='${OLD_CONSULTANT}';`);
  console.log('  기대 rows-affected == 1.');
  console.log('  APPLY=1 로 실행.');
  process.exit(0);
}

// APPLY: idempotency guard(.eq consultant_id=OLD) + .select() 로 rows-affected 확인
console.log('\n[APPLY] UPDATE 실행...');
const { data: updated, error } = await supabase.from('check_ins')
  .update({ consultant_id: NEW_CONSULTANT })
  .eq('id', TARGET_PK).eq('consultant_id', OLD_CONSULTANT)
  .select('id, customer_name, consultant_id');
if (error) { console.error('⛔ UPDATE error:', error); process.exit(2); }

// cross_crm_write_rowcheck_standard: rows-affected==1 (0-row+error=null 성공오인 금지)
const affected = (updated ?? []).length;
console.log(`  rows-affected: ${affected}`);
if (affected !== 1) { console.error(`⛔ ROWCHECK FAIL: rows-affected=${affected} ≠ 1 (silent write-failure 의심). 중단.`); process.exit(4); }
console.log('  ✓ ROWCHECK PASS (rows-affected==1)');
console.log('  updated row:', JSON.stringify(updated[0]));

// POSTCHECK: 독립 SELECT 로 실 영속 확인
const { data: post } = await supabase.from('check_ins')
  .select('id, customer_name, consultant_id, status, visit_type').eq('id', TARGET_PK);
console.log('  POSTCHECK:', JSON.stringify(post[0]));
if (post[0].consultant_id !== NEW_CONSULTANT) { console.error('⛔ POSTCHECK FAIL: consultant_id 미반영'); process.exit(5); }
console.log('  ✓ POSTCHECK PASS — consultant_id = 강경민 확정.');
