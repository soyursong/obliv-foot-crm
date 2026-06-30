/**
 * T-20260701-foot-DUMMY-DATE-UPDATE — INSPECT (SELECT-first, 읽기 전용)
 * 경과분석 탭(ProgressTargetsSection) = reservations 테이블 read:
 *   clinic_id, reservation_date=오늘, progress_check_required=true, status!=cancelled.
 * 목표: 6/30 더미(테스트) progress 예약 3~4건을 식별 → 7/1로 이동 후보 확정.
 *   더미 식별: customers.is_simulation=true OR memo '[TEST-DUMMY...]' OR 이름 '테스트/더미'.
 * 실환자 미포함 확인용 — UPDATE 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const FROM_DATE = '2026-06-30';
const TO_DATE = '2026-07-01';

// ── 1) 6/30 progress_check_required=true 예약 전체 (경과분석 탭 대상) ──
const { data: resv630, error: e1 } = await sb
  .from('reservations')
  .select('id, clinic_id, customer_id, customer_name, reservation_date, reservation_time, progress_check_required, progress_check_label, status, registrar_name, memo')
  .eq('reservation_date', FROM_DATE)
  .eq('progress_check_required', true)
  .neq('status', 'cancelled')
  .order('reservation_time', { ascending: true });
if (e1) { console.error('resv 6/30 SELECT FAIL:', e1); process.exit(1); }

console.log(`\n=== [6/30] progress_check_required=true (경과분석 탭 대상) : ${resv630.length}건 ===`);

// 고객 메타 보강 (is_simulation/memo/name)
const custIds = [...new Set((resv630 ?? []).map(r => r.customer_id).filter(Boolean))];
let custMap = new Map();
if (custIds.length) {
  const { data: custs, error: e2 } = await sb
    .from('customers')
    .select('id, name, phone, is_simulation, memo, chart_number')
    .in('id', custIds);
  if (e2) { console.error('customers SELECT FAIL:', e2); process.exit(1); }
  for (const c of custs ?? []) custMap.set(c.id, c);
}

const isDummy = (r) => {
  const c = r.customer_id ? custMap.get(r.customer_id) : null;
  const name = (r.customer_name || c?.name || '');
  const memo = `${r.memo || ''} ${c?.memo || ''}`;
  return (c?.is_simulation === true)
    || /TEST-DUMMY|테스트|더미|DUMMY|TEST/i.test(memo)
    || /테스트|더미/.test(name);
};

const dummyRows = [];
for (const r of resv630) {
  const c = r.customer_id ? custMap.get(r.customer_id) : null;
  const tag = isDummy(r) ? '★DUMMY' : 'real?';
  console.log(`  [${tag}] ${r.reservation_time?.slice(0,5)} | ${r.customer_name} (chart ${c?.chart_number ?? '—'}) | label=${r.progress_check_label ?? '—'} | status=${r.status} | sim=${c?.is_simulation ?? '—'} | memo=${(c?.memo||r.memo||'').slice(0,40)} | rid=${r.id}`);
  if (isDummy(r)) dummyRows.push(r);
}

console.log(`\n=== 더미 식별 후보: ${dummyRows.length}건 (UPDATE 대상) ===`);
for (const r of dummyRows) {
  console.log(`  UPDATE 대상 rid=${r.id} | ${r.customer_name} | ${r.reservation_time?.slice(0,5)} | ${r.progress_check_label ?? '—'}`);
}

// ── 2) 참조: 7/1 현재 progress 대상 (이동 후 합쳐질 목록) ──
const { data: resv701, error: e3 } = await sb
  .from('reservations')
  .select('id, customer_name, reservation_time, progress_check_label, status')
  .eq('reservation_date', TO_DATE)
  .eq('progress_check_required', true)
  .neq('status', 'cancelled');
if (e3) { console.error('resv 7/1 SELECT FAIL:', e3); process.exit(1); }
console.log(`\n=== [7/1 현재] progress_check_required=true : ${resv701?.length ?? 0}건 (이동 후 ${(resv701?.length ?? 0) + dummyRows.length}건 예상) ===`);
for (const r of resv701 ?? []) console.log(`  ${r.reservation_time?.slice(0,5)} | ${r.customer_name} | ${r.progress_check_label ?? '—'}`);

// 머신 판독용 ID 목록 출력
console.log(`\nDUMMY_RID_LIST=${dummyRows.map(r => r.id).join(',')}`);
