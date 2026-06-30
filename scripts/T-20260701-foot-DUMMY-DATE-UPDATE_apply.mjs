/**
 * T-20260701-foot-DUMMY-DATE-UPDATE — APPLY (prod UPDATE: reservation_date 6/30 → 7/1)
 * 대상: 경과분석 더미 예약 4건 (전부 is_simulation=true, memo '[TEST-DUMMY...]').
 *   rid 명시 + 가드(reservation_date=6/30, progress_check_required=true) → 실환자/전체일괄 변경 차단.
 * 가드: SELECT-first(_inspect.mjs) 통과 — 6/30 progress 4건 전부 더미, 실환자 0건 확인.
 * 롤백: _rollback.sql (7/1 → 6/30 원복).
 * DRY-RUN: node ..._apply.mjs           (기본 — 변경 없음, 대상만 출력)
 * APPLY  : node ..._apply.mjs --apply    (실제 UPDATE)
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const APPLY = process.argv.includes('--apply');
const FROM_DATE = '2026-06-30';
const TO_DATE = '2026-07-01';

// SELECT-first(_inspect.mjs)로 확정한 더미 reservation id 4건.
const DUMMY_RIDS = [
  '89dd247d-1bed-4f5e-a4cd-9bb9a33669b0', // 테스트경과01 14:00 6회
  '8d9ee9ad-b8ef-495f-aa6b-799dcfd79a74', // 테스트경과02 14:30 12회
  'd063cba1-90ad-49f1-9a69-113a791f7a78', // 테스트경과03 15:00 18회
  '78f64a7c-a0c5-4cd2-b94a-d8a0c5bb76bc', // 테스트경과분석 15:30 24회
];

// ── 0) 재확인: 대상 4건이 여전히 6/30 progress 더미인지 (apply 직전 가드) ──
const { data: pre, error: e0 } = await sb
  .from('reservations')
  .select('id, customer_name, reservation_date, reservation_time, progress_check_required, status')
  .in('id', DUMMY_RIDS);
if (e0) { console.error('pre-check FAIL:', e0); process.exit(1); }
console.log(`대상 ${pre.length}건 재확인:`);
for (const r of pre) console.log(`  ${r.customer_name} | ${r.reservation_date} ${r.reservation_time?.slice(0,5)} | progress=${r.progress_check_required} | ${r.status} | rid=${r.id}`);

const bad = pre.filter(r => r.reservation_date !== FROM_DATE || r.progress_check_required !== true);
if (bad.length) { console.error('ABORT: 6/30/progress 가드 불일치 레코드 존재:', bad.map(b=>b.id)); process.exit(1); }
if (pre.length !== DUMMY_RIDS.length) { console.error(`ABORT: 대상 수 불일치 (${pre.length} != ${DUMMY_RIDS.length})`); process.exit(1); }

if (!APPLY) {
  console.log(`\n[DRY-RUN] 변경 없음. --apply 로 실제 실행. 대상 ${DUMMY_RIDS.length}건 → reservation_date ${FROM_DATE} → ${TO_DATE}`);
  process.exit(0);
}

// ── 1) UPDATE: reservation_date 6/30 → 7/1 (rid IN + 6/30 가드) ──
const { data: upd, error: e1 } = await sb
  .from('reservations')
  .update({ reservation_date: TO_DATE })
  .in('id', DUMMY_RIDS)
  .eq('reservation_date', FROM_DATE)            // 가드: 6/30만
  .eq('progress_check_required', true)          // 가드: progress만
  .select('id, customer_name, reservation_date, reservation_time');
if (e1) { console.error('UPDATE FAIL:', e1); process.exit(1); }
console.log(`\n[APPLY] UPDATE OK: ${upd.length}건 → ${TO_DATE}`);
for (const r of upd) console.log(`  ${r.customer_name} | ${r.reservation_date} ${r.reservation_time?.slice(0,5)} | rid=${r.id}`);
if (upd.length !== DUMMY_RIDS.length) { console.error(`WARN: UPDATE 수 불일치 (${upd.length} != ${DUMMY_RIDS.length})`); }
