/**
 * 풋센터 CRM 셀프접수 테스트 더미 예약 20건 — 5/18 현장 테스트용
 * T-20260517-foot-SELFCHECKIN-TESTDATA5
 * 초진 20건 only (재진 없음) / [TEST5] prefix + is_simulation=true
 * ⚠️ 체크인(check_ins) 생성 금지 — 1/2번차트 4진입경로 검증 전용
 * 선례: T-20260515-foot-SELFCHECKIN-TESTDATA4 (5회차 동일 패턴)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const TARGET_DATE = '2026-05-18';

// 22분 간격 20슬롯: 10:00~16:58
const NEW_TIMES = [
  '10:00','10:22','10:44','11:06','11:28','11:50',
  '12:12','12:34','12:56','13:18','13:40','14:02',
  '14:24','14:46','15:08','15:30','15:52','16:14',
  '16:36','16:58',
];

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) {
    console.error(`❌ ${label}:`, error.message, JSON.stringify(error));
    throw new Error(`${label}: ${error.message}`);
  }
  return data;
}

async function insertCustomer(clinicId, name, phone) {
  const data = await must(`고객 ${name}`,
    supabase.from('customers').insert({
      clinic_id: clinicId,
      name,
      phone,
      visit_type: 'new',
      is_simulation: true,
    }).select('id').single()
  );
  return data.id;
}

async function insertReservation(clinicId, customerId, name, phone, time) {
  const data = await must(`예약 ${name}`,
    supabase.from('reservations').insert({
      clinic_id: clinicId,
      customer_id: customerId,
      customer_name: name,
      customer_phone: phone,
      reservation_date: TARGET_DATE,
      reservation_time: time,
      visit_type: 'new',
      memo: '[TEST5]더미 — 1/2번차트 4진입경로 검증',
      status: 'confirmed',
    }).select('id').single()
  );
  return data.id;
}

async function main() {
  console.log('🚀 셀프접수 테스트 더미 예약 삽입 시작 ([TEST5], 5/18 초진 20명)');

  // 클리닉 ID 확인
  const { data: clinic, error: clinicErr } = await supabase
    .from('clinics').select('id').eq('slug', 'jongno-foot').single();
  if (clinicErr || !clinic) throw new Error('clinic jongno-foot not found');
  const cid = clinic.id;
  console.log(`✅ 클리닉 ID: ${cid}`);

  // 중복 방지 체크 — +821099050001 존재 여부
  const { data: dupCheck } = await supabase
    .from('customers')
    .select('id')
    .eq('phone', '+821099050001')
    .eq('clinic_id', cid)
    .maybeSingle();
  if (dupCheck) {
    console.log('⚠️ +821099050001 이미 존재 — 이미 삽입된 것으로 보입니다.');
    const { data: existing } = await supabase
      .from('reservations')
      .select('id, customer_name, visit_type, status, reservation_time')
      .ilike('customer_name', '[TEST5]%')
      .eq('reservation_date', TARGET_DATE);
    console.log(`  기존 TEST5 예약: ${existing?.length || 0}건`);
    if (existing) existing.forEach(r => console.log(`  - ${r.customer_name} / ${r.visit_type} / ${r.reservation_time} / ${r.status}`));
    process.exit(0);
  }

  // ==========================================================
  // 초진 20건 (visit_type: 'new', 체크인 없음)
  // ==========================================================
  console.log('\n--- 초진 20건 ---');
  let inserted = 0;

  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    const name = `[TEST5] 초진고객${num}`;
    const phone = `+82109905${String(i).padStart(4, '0')}`;  // +821099050001 ~ +821099050020
    const time = NEW_TIMES[i - 1];

    const custId = await insertCustomer(cid, name, phone);
    await insertReservation(cid, custId, name, phone, time);
    console.log(`  ✅ ${i}. ${name} (${phone}, ${time}, new, confirmed — 체크인 없음)`);
    inserted++;
  }

  console.log(`\n✅ 완료: ${inserted}/20건 삽입됨 (예약만, 체크인 없음)`);
  console.log(`📅 예약일: ${TARGET_DATE}`);
  console.log(`🔖 prefix: [TEST5]`);
  console.log(`📞 phone: +821099050001 ~ +821099050020`);
  console.log(`⏰ 시간대: 10:00~16:58 (22분 간격 20슬롯)`);

  // ==========================================================
  // 검증 — phone 기준 confirmed 예약 매칭 확인
  // ==========================================================
  console.log('\n--- 검증: phone → confirmed 예약 매칭 ---');
  const testPhones = ['+821099050001', '+821099050005', '+821099050010', '+821099050015', '+821099050020'];
  for (const p of testPhones) {
    const { data: res, error: resErr } = await supabase
      .from('reservations')
      .select('id, customer_name, visit_type, status, reservation_time')
      .eq('customer_phone', p)
      .eq('reservation_date', TARGET_DATE)
      .eq('status', 'confirmed')
      .single();
    if (resErr || !res) {
      console.log(`  ❌ ${p}: 예약 미조회 (${resErr?.message})`);
    } else {
      console.log(`  ✅ ${p}: ${res.customer_name} / ${res.visit_type} / ${res.reservation_time} / ${res.status}`);
    }
  }

  // 전체 카운트 확인
  const { count: totalCount } = await supabase
    .from('reservations')
    .select('id', { count: 'exact', head: true })
    .ilike('customer_name', '[TEST5]%')
    .eq('reservation_date', TARGET_DATE)
    .eq('status', 'confirmed');
  console.log(`\n📊 최종 확인: [TEST5] 5/18 confirmed 예약 = ${totalCount}건`);

  // customer_id 연결 확인 (3명 샘플)
  console.log('\n--- customer_id 연결 확인 (3명 샘플) ---');
  const { data: sampleRes } = await supabase
    .from('reservations')
    .select('id, customer_id, customer_name, reservation_time')
    .ilike('customer_name', '[TEST5]%')
    .eq('reservation_date', TARGET_DATE)
    .order('reservation_time')
    .limit(3);
  if (sampleRes) {
    for (const r of sampleRes) {
      const { data: cust } = await supabase
        .from('customers')
        .select('id, name, visit_type, is_simulation')
        .eq('id', r.customer_id)
        .single();
      console.log(`  ✅ ${r.customer_name} | reservation_id: ${r.id} | customer_id: ${r.customer_id} | visit_type: ${cust?.visit_type} | is_simulation: ${cust?.is_simulation}`);
    }
  }

  console.log('\n🎯 차트 검증 준비 완료 — 4진입경로(Dashboard/CheckInDetail/Customers/URL)에서 1번+2번차트 확인 가능');
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
