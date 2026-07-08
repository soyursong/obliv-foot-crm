/**
 * T-20260708-foot-QUICKRESV-TESTDATA-BUG — 전체 의존성 트리 인벤토리 (read-only)
 * customers ← reservations ← check_ins ← 손자행. 실제 존재행만 카운트.
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CUST = '41c2852c-d647-474c-8777-bc17111ff7d1';

// 1) reservations
const { data: resv } = await sb.from('reservations').select('id').eq('customer_id', CUST);
const resvIds = (resv||[]).map(r=>r.id);
console.log('reservations:', resvIds);

// 2) check_ins (customer_id OR reservation_id)
const { data: ciByCust } = await sb.from('check_ins').select('id, reservation_id, customer_id, status, visit_type, created_at').eq('customer_id', CUST);
const { data: ciByResv } = resvIds.length ? await sb.from('check_ins').select('id, reservation_id, customer_id, status, visit_type, created_at').in('reservation_id', resvIds) : { data: [] };
const ciMap = new Map();
for (const c of [...(ciByCust||[]), ...(ciByResv||[])]) ciMap.set(c.id, c);
const checkInIds = [...ciMap.keys()];
console.log('check_ins:', JSON.stringify([...ciMap.values()]));

// 3) 모든 자식 테이블 카운트 (grep 기반, 실제명). fk_col, parent_ids
const CHILDREN = [
  // reservations(id) 참조
  ['reservation_logs', 'reservation_id', resvIds, 'CASCADE'],
  ['reservation_memo_history', 'reservation_id', resvIds, 'CASCADE'],
  // check_ins(id) 참조
  ['service_charges', 'check_in_id', checkInIds, 'RESTRICT'],
  ['check_in_room_logs', 'check_in_id', checkInIds, 'CASCADE'],
  ['consent_forms', 'check_in_id', checkInIds, 'RESTRICT'],
  ['consent_forms', 'customer_id', [CUST], 'RESTRICT'],
  ['receipt_ocr_results', 'check_in_id', checkInIds, 'SET NULL'],
  ['insurance_claims', 'check_in_id', checkInIds, 'SET NULL'],
  ['clinical_images', 'check_in_id', checkInIds, 'SET NULL'],
  ['package_sessions', 'check_in_id', checkInIds, 'RESTRICT'],
  ['checklists', 'check_in_id', checkInIds, 'SET NULL'],
  ['checklists', 'customer_id', [CUST], 'RESTRICT'],
  ['health_q_tokens', 'check_in_id', checkInIds, 'SET NULL'],
  ['health_q_results', 'check_in_id', checkInIds, 'SET NULL'],
  ['payments', 'check_in_id', checkInIds, 'RESTRICT'],
  ['prescriptions', 'check_in_id', checkInIds, 'RESTRICT'],
  ['prescriptions', 'customer_id', [CUST], 'RESTRICT'],
  // 기타 customers 직접참조
  ['packages', 'customer_id', [CUST], 'RESTRICT'],
  ['service_charges', 'customer_id', [CUST], 'RESTRICT'],
];
console.log('\n--- 손자/자식 인벤토리 (존재행만) ---');
let blockers = [];
for (const [t, col, ids, del] of CHILDREN) {
  if (!ids || ids.length === 0) continue;
  const { data, error } = await sb.from(t).select('id').in(col, ids);
  if (error) { console.log(`  ${t}.${col} [${del}] : ERR ${error.message}`); continue; }
  if (data.length > 0) { console.log(`  ${t}.${col} [${del}] : ${data.length}행`); if (del==='RESTRICT') blockers.push(`${t}.${col}=${data.length}`); }
}
console.log('\nRESTRICT blockers(선삭제 필요):', blockers.length ? blockers.join(', ') : '없음(reservations/check_ins 외)');
console.log('checkInIds =', JSON.stringify(checkInIds));
