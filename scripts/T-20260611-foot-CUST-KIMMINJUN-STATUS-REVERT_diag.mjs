/**
 * T-20260611-foot-CUST-KIMMINJUN-STATUS-REVERT — DIAGNOSTIC (read-only)
 * verify-first 가드 Step 1·2: '김민준' 조회 + UPDATE 대상 행/현재값(before) 캡처.
 * 어떤 UPDATE 도 실행하지 않음. 식별만.
 * 치료대기 = check_ins.status='treatment_waiting'
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const NAME = '김민준';

// (1) customers 테이블 — 동명이인 점검
const { data: custs, error: ce } = await sb.from('customers')
  .select('id, name, phone, chart_number, clinic_id, is_simulation, created_at')
  .eq('name', NAME);
console.log('=== customers name=김민준 ===');
console.log('count:', custs?.length, 'err:', ce);
console.log(JSON.stringify(custs, null, 2));

// (2) check_ins 테이블 — 오늘/최근 칸반 엔트리 (status 보유처)
const { data: cis, error: cie } = await sb.from('check_ins')
  .select('id, customer_id, customer_name, customer_phone, visit_type, status, checked_in_at, called_at, completed_at, clinic_id, created_at')
  .eq('customer_name', NAME)
  .order('checked_in_at', { ascending: false })
  .limit(50);
console.log('\n=== check_ins customer_name=김민준 (recent 50) ===');
console.log('count:', cis?.length, 'err:', cie);
console.log(JSON.stringify(cis, null, 2));

// (3) customer_id 기준 교차 (동명이인 분리 확인)
if (custs && custs.length > 0) {
  for (const c of custs) {
    const { data: byId } = await sb.from('check_ins')
      .select('id, customer_name, status, visit_type, checked_in_at, completed_at')
      .eq('customer_id', c.id)
      .order('checked_in_at', { ascending: false }).limit(20);
    console.log(`\n=== check_ins for customer_id=${c.id} (${c.name}/${c.phone}) ===`);
    console.log(JSON.stringify(byId, null, 2));
  }
}
