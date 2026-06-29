/**
 * T-20260629-foot-OPINIONDOC-DRAFT-MIXED-CLEANUP — AC-2 apply (MUTATION, GATE-GUARDED)
 *
 * ⛔ supervisor `mutation_gate: supervisor_required` GO 후에만 실행.
 *    코드레벨 게이트: 환경변수 MUTATION_GATE_GO=1 없으면 즉시 거부(dev 단독 mutation 방지).
 *      실행:  MUTATION_GATE_GO=1 node scripts/T-20260629-foot-OPINIONDOC-DRAFT-MIXED-CLEANUP_ac2_apply.mjs
 *
 * 절차(AC-2): backup 캡처 → 범위 재확인(혼합 1건·정확히 [oral_x,bp_med]) → UPDATE([bp_med]) → post-verify(혼합 0건).
 *   - 혼합 매칭 ≠ 1 또는 대상 before 불일치 시 mutation 미실행·중단(멱등/범위 변동 방어).
 *   - rollback 은 _ac2_rollback.sql 또는 backup 출력으로.
 */
import { createClient } from '@supabase/supabase-js';

if (process.env.MUTATION_GATE_GO !== '1') {
  console.error('⛔ MUTATION GATE — supervisor GO 미확인(MUTATION_GATE_GO!=1). UPDATE 거부. 실행 중단.');
  process.exit(3);
}

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TARGET_ID = 'ff9fd4ad-1f91-4923-b688-9d8f8dfb878b';
const EXPECT_BEFORE = ['oral_x', 'bp_med']; // 혼합 원본(진단서 oral_x + 금기증 bp_med)
const AFTER = ['bp_med'];                   // 정규화(금기증 우선, 진단서 clear)

const eqArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

// 1) backup + 범위 재확인 (read).
const { data: row, error: readErr } = await sb
  .from('form_submissions')
  .select('id, status, field_data')
  .eq('id', TARGET_ID)
  .maybeSingle();
if (readErr) { console.error('READ ERROR:', JSON.stringify(readErr)); process.exit(1); }
if (!row) { console.error(`⛔ 대상 행 부재(id=${TARGET_ID}). 중단.`); process.exit(1); }

const before = Array.isArray(row.field_data?.selected_keys) ? row.field_data.selected_keys.map(String) : [];
console.log('======== AC-2 apply (GATE GO) ========');
console.log(`[BACKUP] id=${row.id} status=${row.status} selected_keys=${JSON.stringify(before)}`);

if (eqArr(before, AFTER)) {
  console.log('✅ 이미 정규화 상태([bp_med]) — 멱등, mutation 불요. 종료.');
  process.exit(0);
}
if (row.status !== 'draft' || !eqArr(before, EXPECT_BEFORE)) {
  console.error(`⛔ 범위 불일치 — status=${row.status}, before=${JSON.stringify(before)} (기대 draft / ${JSON.stringify(EXPECT_BEFORE)}). mutation 미실행 중단(planner 재판정).`);
  process.exit(2);
}

// 2) UPDATE — selected_keys 만 교체(나머지 field_data 보존).
const nextFieldData = { ...row.field_data, selected_keys: AFTER };
const { data: upd, error: updErr } = await sb
  .from('form_submissions')
  .update({ field_data: nextFieldData })
  .eq('id', TARGET_ID)
  .eq('status', 'draft')
  .select('id, field_data');
if (updErr) { console.error('UPDATE ERROR:', JSON.stringify(updErr)); process.exit(1); }
console.log(`[UPDATE] affected=${(upd || []).length} → selected_keys=${JSON.stringify(upd?.[0]?.field_data?.selected_keys)}`);
if ((upd || []).length !== 1) { console.error('⛔ affected rows ≠ 1. rollback 검토.'); process.exit(1); }

// 3) post-verify — 대상 행 [bp_med] + 혼합 불변식 PASS.
const { data: ver } = await sb.from('form_submissions').select('field_data').eq('id', TARGET_ID).maybeSingle();
const after = Array.isArray(ver?.field_data?.selected_keys) ? ver.field_data.selected_keys.map(String) : [];
const ok = eqArr(after, AFTER);
console.log(`[VERIFY] selected_keys=${JSON.stringify(after)} → ${ok ? '✅ PASS ([bp_med], 혼합 0)' : '❌ FAIL'}`);
process.exit(ok ? 0 : 1);
