/**
 * T-20260708-foot-QUICKRESV-TESTDATA-BUG — DELETE APPLY (파괴적)
 *
 * ⚠ Guard3 '진행' 확인 후에만 실행. 안전벨트: env CONFIRM=진행 없으면 abort.
 * 순서: check_ins → reservations → customers (RESTRICT 자식 선삭제, CASCADE 자동).
 * 실행 전 freeze 재검증(대상셋 불변) → 불일치 시 abort. 실행 후 0건 재조회 + orphan 0.
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

if (process.env.CONFIRM !== '진행') {
  console.error('ABORT: Guard3 미확인. 재실행 시 CONFIRM=진행 필요.');
  process.exit(2);
}

const CUST = '41c2852c-d647-474c-8777-bc17111ff7d1';
const RESV = 'fd13ce8b-e5fe-40f3-8997-f0e1cc6588b2';
const CHECKIN = '0e2dba57-ba1e-47b8-87e9-8d9d4c63a11d';

// ── freeze 재검증 (대상셋 불변 확인) ──
const { data: c0 } = await sb.from('customers').select('id, name').eq('id', CUST);
if (!c0 || c0.length !== 1 || c0[0].name !== '접수테스트2') {
  console.error('ABORT: freeze 불일치 — customer 대상셋 변동.', JSON.stringify(c0)); process.exit(1);
}
const { data: r0 } = await sb.from('reservations').select('id').eq('customer_id', CUST);
const { data: ci0 } = await sb.from('check_ins').select('id').eq('customer_id', CUST);
const rIds = (r0||[]).map(x=>x.id), ciIds = (ci0||[]).map(x=>x.id);
if (rIds.length !== 1 || rIds[0] !== RESV) { console.error('ABORT: reservations 대상셋 변동', JSON.stringify(rIds)); process.exit(1); }
if (ciIds.length !== 1 || ciIds[0] !== CHECKIN) { console.error('ABORT: check_ins 대상셋 변동', JSON.stringify(ciIds)); process.exit(1); }
console.log('freeze 재검증 PASS: customer 1, reservation 1, check_in 1');

// ── RESTRICT 블로커 재확인 (0이어야 함) ──
const RESTRICT_CHECK = [
  ['service_charges', 'check_in_id', ciIds], ['service_charges', 'customer_id', [CUST]],
  ['payments', 'check_in_id', ciIds], ['packages', 'customer_id', [CUST]],
  ['consent_forms', 'customer_id', [CUST]], ['consent_forms', 'check_in_id', ciIds],
  ['prescriptions', 'customer_id', [CUST]], ['checklists', 'customer_id', [CUST]],
  ['package_sessions', 'check_in_id', ciIds],
];
for (const [t, col, ids] of RESTRICT_CHECK) {
  const { data, error } = await sb.from(t).select('id').in(col, ids);
  if (error) continue; // 테이블 미존재 등 무시
  if (data.length > 0) { console.error(`ABORT: RESTRICT 블로커 발생 ${t}.${col}=${data.length}`); process.exit(1); }
}
console.log('RESTRICT 블로커 재확인 PASS: 전부 0');

// ── DELETE (순서 엄수) ──
const d1 = await sb.from('check_ins').delete().eq('id', CHECKIN).select('id');
console.log('DELETE check_ins:', d1.data?.length, 'err:', d1.error?.message);
if (d1.error) process.exit(1);
const d2 = await sb.from('reservations').delete().eq('id', RESV).select('id');
console.log('DELETE reservations:', d2.data?.length, 'err:', d2.error?.message);
if (d2.error) process.exit(1);
const d3 = await sb.from('customers').delete().eq('id', CUST).select('id');
console.log('DELETE customers:', d3.data?.length, 'err:', d3.error?.message);
if (d3.error) process.exit(1);

// ── 삭제후 0건 재조회 + orphan 검증 ──
console.log('\n--- POST-DELETE 검증 ---');
const { data: pc } = await sb.from('customers').select('id').eq('id', CUST);
const { data: pr } = await sb.from('reservations').select('id').eq('id', RESV);
const { data: pci } = await sb.from('check_ins').select('id').eq('id', CHECKIN);
const { data: prl } = await sb.from('reservation_logs').select('id').eq('reservation_id', RESV);
const { data: phq } = await sb.from('health_q_tokens').select('id').eq('customer_id', CUST);
console.log('customers:', pc?.length, '| reservations:', pr?.length, '| check_ins:', pci?.length,
            '| reservation_logs(cascade):', prl?.length, '| health_q_tokens(cascade):', phq?.length);
const allZero = [pc,pr,pci,prl,phq].every(x => (x||[]).length === 0);
console.log(allZero ? '✅ ALL ZERO — 삭제 완료, orphan 잔존 0' : '❌ 잔존행 발견 — 점검 필요');
process.exit(allZero ? 0 : 1);
