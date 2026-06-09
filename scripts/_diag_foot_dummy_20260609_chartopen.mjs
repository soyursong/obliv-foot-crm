/**
 * T-20260608-foot-DUMMY-CHART-OPEN-FIX — READ-ONLY 진단 (3차 재발)
 * 6/9 더미 배치(created_by='test-dummy-20260609') 차트오픈 격번 실패 분기 특정.
 * 분기: (a) customer_id NULL/미연결  vs  (b) 동명이인 가드 발동
 * 코드 분기 재현(Dashboard openChartFor): customer_id 있으면 OPEN / NULL이면 name fallback
 *   → customers(clinic_id,name) 매칭 1건=OPEN, >1=동명이인 거부, 0=미연결 토스트
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DATE = '2026-06-09';

// 1) jongno-foot clinic
const { data: clinics } = await sb.from('clinics').select('id, slug, name').eq('slug', 'jongno-foot');
const CLINIC_ID = clinics?.[0]?.id;
console.log(`[clinic] jongno-foot = ${CLINIC_ID}`);

// 2) 6/9 TESTDATA 배치 (created_by 마커)
const { data: resv, error: re } = await sb.from('reservations')
  .select('id, reservation_time, visit_type, customer_name, customer_id, created_by, memo')
  .eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE)
  .eq('created_by', 'test-dummy-20260609')
  .order('reservation_time', { ascending: true });
if (re) { console.error('resv err', re); process.exit(1); }
console.log(`\n[batch test-dummy-20260609] reservations = ${resv?.length ?? 0}건`);
const nullCid = (resv||[]).filter(r => !r.customer_id).length;
console.log(`  customer_id NULL: ${nullCid} / ${resv?.length} (SET: ${(resv?.length||0)-nullCid})`);

// 3) 각 예약 → name fallback 시뮬레이션
console.log('\n=== 슬롯별 차트오픈 분기 (코드 재현) ===');
console.log('time | vt        | name      | cid? | clinic동명customers | 코드분기');
const branchCount = { OPEN_direct:0, OPEN_fallback1:0, REFUSE_homonym:0, TOAST_unlinked:0 };
for (const r of (resv||[])) {
  let branch;
  if (r.customer_id) { branch = 'OPEN(직결)'; branchCount.OPEN_direct++; }
  else {
    const { data: m } = await sb.from('customers').select('id').eq('clinic_id', CLINIC_ID).eq('name', r.customer_name).limit(3);
    const n = m?.length ?? 0;
    if (n === 1) { branch = `OPEN(fallback 1건)`; branchCount.OPEN_fallback1++; }
    else if (n > 1) { branch = `거부(동명이인 ${n})`; branchCount.REFUSE_homonym++; }
    else { branch = '토스트(미연결 0건)'; branchCount.TOAST_unlinked++; }
    r._matchN = n;
  }
  console.log(`${(r.reservation_time||'').slice(0,5)} | ${(r.visit_type||'').padEnd(9)} | ${(r.customer_name||'').padEnd(6)} | ${r.customer_id?'SET':'NULL'} | ${r.customer_id?'-':r._matchN} | ${branch}`);
}
console.log('\n=== 분기 집계 ===');
console.log(JSON.stringify(branchCount, null, 2));

// 4) 다른 6/9 배치(JONGNO, memo 마커)도 같이 봐서 동명 충돌 출처 확인
const { data: jongno } = await sb.from('customers')
  .select('id, name, is_simulation, memo').eq('clinic_id', CLINIC_ID).eq('memo', '[TEST-DUMMY 20260609]');
console.log(`\n[참고] JONGNO 배치 customers(memo='[TEST-DUMMY 20260609]') = ${jongno?.length ?? 0}건`);

// 5) clinic 전체에서 동명이인(이름 중복 customers) 존재 여부 — 거부 분기 출처
console.log('\n=== TESTDATA 예약명별 customers 매칭 분포 (clinic 전체) ===');
const names = [...new Set((resv||[]).map(r=>r.customer_name))];
for (const nm of names) {
  const { data: m } = await sb.from('customers').select('id, is_simulation, memo').eq('clinic_id', CLINIC_ID).eq('name', nm);
  if ((m?.length ?? 0) !== 1) {
    console.log(`  ${nm.padEnd(6)} → ${m?.length ?? 0}건 ${(m||[]).map(x=>x.memo||'(real)').join(',')}`);
  }
}
console.log('\n=== DONE (read-only, no writes) ===');
