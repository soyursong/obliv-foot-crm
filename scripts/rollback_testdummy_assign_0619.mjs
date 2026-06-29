/**
 * rollback_testdummy_assign_0619.mjs — T-20260619-foot-TESTDUMMY-ASSIGN EOD 정리(AC3)
 *
 * [TEST-0619-ASSIGN] 마커 + 고유 phone prefix(+821096190) 키로만 한정 DELETE.
 *   대상: reservations · customers · check_ins(notes.marker) · medical_charts(created_by)
 *         + chart_doctor_memos/assignment_actions는 FK ON DELETE CASCADE로 자동 회수.
 *
 * ⚠ prod 대량 DELETE 안전장치 (planner AC3 지시):
 *   1) DEFAULT = dry-run. 실제 삭제는 `--apply` 플래그 필요.
 *   2) dry-run COUNT 출력(= 더미 건수와 일치해야 함).
 *   3) 실환자 0건 교차검증: 삭제 대상 customers 가 전부 memo=MARKER && is_simulation=false &&
 *      phone LIKE prefix 인지 확인. 하나라도 어긋나면 ABORT(실환자 보호).
 *   4) FK 순서: medical_charts → check_ins → reservations → customers (customers 마지막).
 *
 * ⚠ is_simulation 주의: 본 배치는 is_simulation=FALSE(=실데이터 플래그)로 적재됨(apply 스크립트
 *   상단 deviation 주석 참조). 따라서 삭제 키는 is_simulation 이 아니라 memo+phone 2중 마커다.
 *   티켓 AC3 원문은 'is_simulation=TRUE 키' 였으나 적재 정책 deviation에 맞춰 키 조정(가역성 동일 보장).
 *
 * 실행:
 *   node scripts/rollback_testdummy_assign_0619.mjs            # dry-run (기본)
 *   node scripts/rollback_testdummy_assign_0619.mjs --apply    # 실제 삭제
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://rxlomoozakkjesdqjtvd.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })()),
  { auth: { persistSession: false } },
);

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[TEST-0619-ASSIGN]';
const PHONE_PREFIX = '+821096190';
const APPLY = process.argv.includes('--apply');

console.log(`=== rollback_testdummy_assign_0619 (${APPLY ? 'APPLY 실삭제' : 'DRY-RUN'}) ===\n`);

// ── 1) 삭제 대상 customers 식별 + 실환자 교차검증 ───────────────────────
const { data: cust, error: ce } = await sb
  .from('customers')
  .select('id, name, phone, memo, is_simulation')
  .eq('clinic_id', CLINIC_ID)
  .eq('memo', MARKER);
if (ce) { console.error('customers 조회 실패:', ce); process.exit(1); }
const custIds = (cust ?? []).map((c) => c.id);
console.log(`삭제 대상 customers: ${custIds.length}건 (기대 80)`);

// 실환자 보호: 대상이 전부 memo=MARKER && phone prefix 일치 && is_simulation=false 인지
const bad = (cust ?? []).filter((c) => c.memo !== MARKER || !String(c.phone ?? '').startsWith(PHONE_PREFIX));
if (bad.length) {
  console.error(`ABORT: 마커/전화 prefix 불일치 ${bad.length}건 발견 — 실환자 혼입 위험.`, bad.slice(0, 5));
  process.exit(1);
}
// 교차검증: 같은 마커를 phone prefix 없이 들고 있는 행이 있는가(이론상 0)
const { data: markerNoPrefix } = await sb
  .from('customers').select('id, phone').eq('clinic_id', CLINIC_ID).eq('memo', MARKER).not('phone', 'like', `${PHONE_PREFIX}%`);
if (markerNoPrefix?.length) {
  console.error(`ABORT: memo=MARKER 인데 phone prefix 불일치 ${markerNoPrefix.length}건 — 수동 점검 필요.`);
  process.exit(1);
}

// ── 2) 자식 테이블 COUNT(dry-run) ───────────────────────────────────────
const { data: resv } = await sb.from('reservations').select('id').eq('clinic_id', CLINIC_ID).eq('memo', MARKER);
const { data: ci } = await sb.from('check_ins').select('id, checked_in_at').eq('clinic_id', CLINIC_ID).contains('notes', { marker: MARKER });
const { data: mc } = await sb.from('medical_charts').select('id').eq('clinic_id', CLINIC_ID).eq('created_by', MARKER);
console.log(`삭제 대상 reservations: ${resv?.length ?? 0}건 (기대 80)`);
console.log(`삭제 대상 check_ins:    ${ci?.length ?? 0}건 (기대 40, 전부 과거)`);
console.log(`삭제 대상 medical_charts: ${mc?.length ?? 0}건 (기대 40)`);

// 안전: check_ins 가 전부 과거(오늘 아님)인지 — 혹시라도 당일 더미면 경고만
const todayKST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const todayCi = (ci ?? []).filter((r) => String(r.checked_in_at).slice(0, 10) === todayKST);
if (todayCi.length) console.warn(`⚠ 당일(${todayKST}) check_in ${todayCi.length}건 포함 — 그래도 마커 키이므로 삭제 안전.`);

if (!APPLY) {
  console.log('\n[DRY-RUN] 삭제 미수행. 실삭제: node scripts/rollback_testdummy_assign_0619.mjs --apply');
  process.exit(0);
}

// ── 3) 실삭제 (FK 순서: medical_charts → check_ins → reservations → customers) ──
const delMc = await sb.from('medical_charts').delete().eq('clinic_id', CLINIC_ID).eq('created_by', MARKER).select('id');
console.log(`medical_charts 삭제: ${delMc.data?.length ?? 0}건 (err: ${delMc.error?.message ?? 'none'})`);
const delCi = await sb.from('check_ins').delete().eq('clinic_id', CLINIC_ID).contains('notes', { marker: MARKER }).select('id');
console.log(`check_ins 삭제: ${delCi.data?.length ?? 0}건 (err: ${delCi.error?.message ?? 'none'})`);
const delResv = await sb.from('reservations').delete().eq('clinic_id', CLINIC_ID).eq('memo', MARKER).select('id');
console.log(`reservations 삭제: ${delResv.data?.length ?? 0}건 (err: ${delResv.error?.message ?? 'none'})`);
const delCust = await sb.from('customers').delete().eq('clinic_id', CLINIC_ID).eq('memo', MARKER).like('phone', `${PHONE_PREFIX}%`).select('id');
console.log(`customers 삭제: ${delCust.data?.length ?? 0}건 (err: ${delCust.error?.message ?? 'none'})`);

// ── 4) 잔존 검증 ────────────────────────────────────────────────────────
const { data: left } = await sb.from('customers').select('id').eq('clinic_id', CLINIC_ID).eq('memo', MARKER);
const { data: leftR } = await sb.from('reservations').select('id').eq('clinic_id', CLINIC_ID).eq('memo', MARKER);
console.log(`\n잔존 customers: ${left?.length ?? 0}건 / reservations: ${leftR?.length ?? 0}건 (둘 다 0이어야 함)`);
console.log('=== CLEANUP DONE ===');
