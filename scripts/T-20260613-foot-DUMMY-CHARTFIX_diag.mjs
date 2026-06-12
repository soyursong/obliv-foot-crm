/**
 * T-20260613-foot-DUMMY-CHARTFIX — AC-1 진단 (read-only)
 * 6/13 jongno-foot 예약/고객 현황 정밀 진단:
 *  - customer_id NULL 건수
 *  - 총 reservation 건수 (26 기대) + 중복 생성 여부
 *  - 실제 더미 마커(memo/phone prefix/is_simulation) 식별
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const EXPECT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-06-13';

// 0) slug resolve
const { data: clinics, error: cerr } = await sb.from('clinics').select('id, slug, name').eq('slug', 'jongno-foot');
if (cerr) { console.error('clinic resolve fail:', cerr); process.exit(1); }
const CLINIC_ID = clinics?.[0]?.id;
console.log(`[slug resolve] jongno-foot = ${CLINIC_ID} (${clinics?.[0]?.name})`);
console.log(`  기대값 일치: ${CLINIC_ID === EXPECT_CLINIC_ID}`);

// 1) 6/13 전체 예약 (마커 무관)
const { data: allResv, error: re } = await sb.from('reservations')
  .select('id, customer_id, customer_name, customer_phone, reservation_time, visit_type, status, memo, created_at')
  .eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).order('reservation_time');
if (re) { console.error('resv query fail:', re); process.exit(1); }
console.log(`\n=== 6/13 전체 예약: ${allResv.length}건 (26 기대) ===`);

// memo 마커별 분포
const byMemo = {};
allResv.forEach(r => { const k = r.memo || '(null)'; byMemo[k] = (byMemo[k]||0)+1; });
console.log('memo 분포:', JSON.stringify(byMemo, null, 0));

// customer_id NULL
const nullCid = allResv.filter(r => !r.customer_id);
console.log(`customer_id NULL: ${nullCid.length}건`);

// visit_type 분포
const byVt = {};
allResv.forEach(r => { byVt[r.visit_type] = (byVt[r.visit_type]||0)+1; });
console.log('visit_type 분포:', JSON.stringify(byVt));

// 중복 의심: 같은 (이름, 시간) 또는 (이름) 중복
const nameCount = {};
allResv.forEach(r => { nameCount[r.customer_name] = (nameCount[r.customer_name]||0)+1; });
const dupNames = Object.entries(nameCount).filter(([,c]) => c > 1);
console.log(`이름 중복: ${dupNames.length}건`, dupNames.length ? JSON.stringify(dupNames) : '');

// 슬롯별 건수 (중복 슬롯 채움 여부)
const bySlot = {};
allResv.forEach(r => { const t = r.reservation_time?.slice(0,5); bySlot[t] = (bySlot[t]||0)+1; });
console.log('슬롯별 건수:', JSON.stringify(bySlot));

// created_at 분포 (이중 생성 = 두 배치 시각)
const byCreated = {};
allResv.forEach(r => { const t = (r.created_at||'').slice(0,16); byCreated[t] = (byCreated[t]||0)+1; });
console.log('created_at(분단위) 분포:', JSON.stringify(byCreated));

// 2) 6/13 더미 후보 customers (phone prefix +82108813 또는 memo 마커)
const { data: cust8813 } = await sb.from('customers')
  .select('id, name, phone, visit_type, chart_number, is_simulation, memo, created_at')
  .eq('clinic_id', CLINIC_ID).like('phone', '+82108813%');
console.log(`\n=== customers phone +82108813*: ${cust8813?.length||0}건 ===`);
const { data: cust0613memo } = await sb.from('customers')
  .select('id, name, phone, is_simulation, chart_number')
  .eq('clinic_id', CLINIC_ID).eq('memo', '[TEST-DUMMY 20260613]');
console.log(`customers memo='[TEST-DUMMY 20260613]': ${cust0613memo?.length||0}건`);
if (cust0613memo?.length) {
  const simT = cust0613memo.filter(c=>c.is_simulation).length;
  const noChart = cust0613memo.filter(c=>!c.chart_number).length;
  console.log(`  is_simulation=true: ${simT} / chart_number 없음: ${noChart}`);
}

// 3) 예약 행별 customer 링크 무결성 (chart_number/clinic_id 결손 점검)
if (allResv.length) {
  const cids = [...new Set(allResv.filter(r=>r.customer_id).map(r=>r.customer_id))];
  const { data: linked } = await sb.from('customers')
    .select('id, name, chart_number, clinic_id, is_simulation, phone, memo')
    .in('id', cids.slice(0,1000));
  const linkedMap = {}; (linked||[]).forEach(c=>linkedMap[c.id]=c);
  const noChartNum = (linked||[]).filter(c=>!c.chart_number);
  const wrongClinic = (linked||[]).filter(c=>c.clinic_id !== CLINIC_ID);
  console.log(`\n=== 링크된 customers 무결성 (${linked?.length||0}건) ===`);
  console.log(`  chart_number 결손: ${noChartNum.length}건`, noChartNum.slice(0,5).map(c=>c.name));
  console.log(`  clinic_id 불일치: ${wrongClinic.length}건`);
  console.log(`  is_simulation=true: ${(linked||[]).filter(c=>c.is_simulation).length}건`);
}

// 4) 샘플 5건 raw 덤프
console.log('\n=== 예약 샘플 (앞 8건) ===');
allResv.slice(0,8).forEach(r => console.log(`  ${r.reservation_time?.slice(0,5)} ${r.visit_type} ${r.customer_name} cid=${r.customer_id? 'SET':'NULL'} memo="${r.memo}" status=${r.status}`));

console.log('\n=== DIAG DONE ===');
