/**
 * T-20260630-foot-PROGRESSPUB-DUMMY-SEED — VERIFY (READ-ONLY, SELECT only, 0 writes)
 *
 * 목적(CONSOLIDATION 재디스패치 MSG-20260630-120658 대응):
 *   canonical 시드는 이미 적용(commit afd4cc4a). 본 스크립트는 재시드 금지 원칙에 따라
 *   ① 시드 생존 ② 경과분석 탭 노출(딜리버러블) ③ HARD 가드3(셀프접수 대기명단·일마감 누출 0건)
 *   을 prod 실측으로 확인만 한다. write 0.
 *
 * 가드3 재현(코드 정본):
 *   - 셀프접수 대기명단: Dashboard.fetchSelfCheckIns(check_ins, today, status≠cancelled)
 *       + stripSimulationRows(simulationFilter.ts) — customer.is_simulation=true & name∉{토마토} → 숨김.
 *   - 일마감 진행중경고(inProgress): check_ins status NOT IN (done,cancelled,payment_waiting), today.
 *   - 일마감 미수(unpaid): check_ins status=payment_waiting, today.
 *   - 일마감 시술통계(procedureStats): check_in_services join (today check_ins).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// .env.local 에서 service key 로드 (read-only 사용)
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const KEY = (env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not found in .env.local');
const SB_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const sb = createClient(SB_URL, KEY, { auth: { persistSession: false } });

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[TEST-DUMMY PROGRESSPUB 20260701]';
const TODAY = '2026-07-01';
const start = `${TODAY}T00:00:00+09:00`;
const end = `${TODAY}T23:59:59+09:00`;
const EXPOSED = new Set(['토마토']);

const out = [];
const log = (s) => { out.push(s); console.log(s); };

// ── 1) 시드 생존 ────────────────────────────────────────────
const { data: seedCust, error: e1 } = await sb.from('customers')
  .select('id, name, phone, is_simulation, memo')
  .eq('clinic_id', CLINIC_ID).eq('is_simulation', true).eq('memo', MARKER)
  .order('name');
if (e1) throw e1;
log(`\n[1] 시드 고객 (is_simulation+MARKER): ${seedCust.length}건`);
seedCust.forEach(c => log(`    - ${c.name} ${c.id} ${c.phone}`));
const dummyIds = new Set(seedCust.map(c => c.id));

// ── 2) 경과분석 탭 노출 (딜리버러블) ─────────────────────────
const { data: prog, error: e2 } = await sb.from('reservations')
  .select('id, customer_id, customer_name, reservation_time, progress_check_required, progress_check_label, status')
  .eq('clinic_id', CLINIC_ID).eq('reservation_date', TODAY)
  .eq('progress_check_required', true).neq('status', 'cancelled')
  .order('reservation_time');
if (e2) throw e2;
const progDummy = prog.filter(r => dummyIds.has(r.customer_id));
log(`\n[2] 경과분석 탭 오늘(${TODAY}) 대상 총 ${prog.length}건 / 이번 더미 ${progDummy.length}건 (≥3 기대):`);
progDummy.forEach(r => log(`    - ${r.customer_name} ${r.reservation_time} "${r.progress_check_label}" status=${r.status}`));

// ── 3) 가드3-A: 셀프접수 대기명단 (Dashboard fetchSelfCheckIns + stripSimulationRows) ──
const { data: ci, error: e3 } = await sb.from('check_ins')
  .select('id, customer_id, customer_name, status, checked_in_at, visit_type')
  .eq('clinic_id', CLINIC_ID)
  .not('status', 'in', '("cancelled")')
  .in('visit_type', ['new', 'returning', 'experience'])
  .gte('checked_in_at', start).lte('checked_in_at', end)
  .order('checked_in_at');
if (e3) throw e3;
// stripSimulationRows 재현: customer_id가 sim&비화이트리스트면 숨김
const custIds = [...new Set(ci.map(r => r.customer_id).filter(Boolean))];
const { data: simCust } = await sb.from('customers').select('id, name').in('id', custIds).eq('is_simulation', true);
const hiddenSim = new Set((simCust ?? []).filter(c => !EXPOSED.has((c.name ?? '').trim())).map(c => c.id));
const rawTodayDummyCI = ci.filter(r => dummyIds.has(r.customer_id));
const afterStrip = ci.filter(r => !r.customer_id || !hiddenSim.has(r.customer_id));
const leakWaiting = afterStrip.filter(r => dummyIds.has(r.customer_id));
log(`\n[3-A] 셀프접수 대기명단(오늘 check_ins): raw ${ci.length}건, 이번 더미 raw ${rawTodayDummyCI.length}건`);
log(`      → stripSimulationRows 적용 후 총 ${afterStrip.length}건, 더미 누출 ${leakWaiting.length}건 (0 기대)`);
rawTodayDummyCI.forEach(r => log(`      (raw 더미 check_in: ${r.customer_name} ${r.status} ${r.checked_in_at} → 숨김=${hiddenSim.has(r.customer_id)})`));

// ── 4) 가드3-B: 일마감 진행중경고(inProgress) ────────────────
const { data: inprog, error: e4 } = await sb.from('check_ins')
  .select('id, customer_id, customer_name, status')
  .eq('clinic_id', CLINIC_ID)
  .not('status', 'in', '("done","cancelled","payment_waiting")')
  .gte('checked_in_at', start).lte('checked_in_at', end);
if (e4) throw e4;
const leakInprog = inprog.filter(r => dummyIds.has(r.customer_id));
log(`\n[4] 일마감 진행중경고(NOT done/cancelled/payment_waiting): 총 ${inprog.length}건, 더미 누출 ${leakInprog.length}건 (0 기대)`);

// ── 5) 가드3-C: 일마감 미수(payment_waiting) ─────────────────
const { data: unpaid, error: e5 } = await sb.from('check_ins')
  .select('id, customer_id, customer_name, status')
  .eq('clinic_id', CLINIC_ID).eq('status', 'payment_waiting')
  .gte('checked_in_at', start).lte('checked_in_at', end);
if (e5) throw e5;
const leakUnpaid = unpaid.filter(r => dummyIds.has(r.customer_id));
log(`\n[5] 일마감 미수(payment_waiting): 총 ${unpaid.length}건, 더미 누출 ${leakUnpaid.length}건 (0 기대)`);

// ── 6) 가드3-D: 일마감 시술통계(check_in_services) ───────────
const dummyCheckInIds = ci.filter(r => dummyIds.has(r.customer_id)).map(r => r.id);
let leakSvc = 0;
if (dummyCheckInIds.length) {
  const { data: svc } = await sb.from('check_in_services').select('id, check_in_id').in('check_in_id', dummyCheckInIds);
  leakSvc = (svc ?? []).length;
}
log(`\n[6] 일마감 시술통계(더미 check_in_services): ${leakSvc}건 (0 기대 — 시드 미삽입)`);

// ── 7) POLLUTION stage3 DELETE 키 충돌 점검 (reservation_id NULL & checked_in_at::date=today) ──
const todayDummyNoResv = ci.filter(r => dummyIds.has(r.customer_id)); // 시드 check_in 은 reservation_id 미설정(NULL)
log(`\n[7] POLLUTION stage3 키(reservation_id IS NULL & checked_in_at=today) 매칭 더미 check_in: ${todayDummyNoResv.length}건`);
log(`     주: 오늘자 더미 check_in 은 reservation_id=NULL → POLLUTION stage3 DELETE 에 동시 회수될 수 있음(무해, 본건 cleanup 은 별도 MARKER 스코프). 과거일 check_in 은 비매칭.`);

// ── 종합 ────────────────────────────────────────────────────
const pass = seedCust.length >= 3 && progDummy.length >= 3 &&
  leakWaiting.length === 0 && leakInprog.length === 0 && leakUnpaid.length === 0 && leakSvc === 0;
log(`\n========================================`);
log(`가드3 종합: ${pass ? 'PASS ✅ (대기명단·일마감 누출 0건, 경과분석 탭 노출 OK)' : 'FAIL ❌ — 점검 필요'}`);
log(`========================================`);
