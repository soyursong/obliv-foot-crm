/**
 * T-20260610-foot-DUMMY-RESV-CHARTVERIFY — PRE/POST COUNT (cleanup 검증용 read-only)
 * 더미 조건 매칭 행 수를 보고. 실예약 보호 위해 정밀 조건만 카운트.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[TEST-DUMMY 20260610]';

// reservations: memo marker + clinic + date (planner SQL + 안전조건)
const { data: resv, error: re } = await sb.from('reservations').select('id, customer_name, customer_phone, reservation_date, is_simulation', { count: 'exact' })
  .eq('clinic_id', CLINIC_ID).eq('memo', MARKER);
console.log('RESV[memo marker] count:', resv?.length, 'err:', re);

// customers: 3중 조건 (memo + is_simulation + phone prefix)
const { data: cust3, error: ce3 } = await sb.from('customers').select('id, name, phone, is_simulation, memo')
  .eq('clinic_id', CLINIC_ID).eq('is_simulation', true).eq('memo', MARKER).like('phone', '+82108810%');
console.log('CUST[3중 조건] count:', cust3?.length, 'err:', ce3);

// SAFETY CHECK: planner의 광범위 SQL이 잡을 행 (memo/clinic 무관) — 실예약 오염 여부 점검
const { data: custBroad, error: ceb } = await sb.from('customers').select('id, name, phone, clinic_id, memo, is_simulation')
  .eq('is_simulation', true).like('phone', '+82108810%');
console.log('CUST[broad: is_sim+phone only] count:', custBroad?.length, 'err:', ceb);
const outsideMarker = (custBroad || []).filter(c => c.memo !== MARKER);
console.log('  └ 그중 memo!=MARKER (보호 대상/오삭제 위험):', outsideMarker.length, JSON.stringify(outsideMarker));

console.log('--- sample resv ---', JSON.stringify((resv || []).slice(0, 3)));
console.log('--- sample cust ---', JSON.stringify((cust3 || []).slice(0, 3)));
