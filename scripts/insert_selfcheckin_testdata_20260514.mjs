/**
 * 풋센터 CRM 셀프접수 테스트 더미 예약 20건 — 5/14 현장 테스트용
 * T-20260514-foot-SELFCHECKIN-TESTDATA3
 * 초진 10건 + 재진 10건 / [TEST3] prefix + is_simulation=true
 * ⚠️ 체크인(check_ins) 생성 금지 — 셀프접수 매칭 테스트 전용
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const TARGET_DATE = '2026-05-14';

// --- 헬퍼 ---
function pastDate(daysAgo) {
  const d = new Date(`${TARGET_DATE}T00:00:00+09:00`);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
function pastTs(daysAgo, hour, min = 0) {
  const ds = pastDate(daysAgo);
  return `${ds}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+09:00`;
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) {
    console.error(`❌ ${label}:`, error.message, JSON.stringify(error));
    throw new Error(`${label}: ${error.message}`);
  }
  return data;
}

async function insertCustomer(clinicId, name, phone, visitType) {
  const data = await must(`고객 ${name}`,
    supabase.from('customers').insert({
      clinic_id: clinicId,
      name,
      phone,
      visit_type: visitType,
      is_simulation: true,
    }).select('id').single()
  );
  return data.id;
}

async function insertReservation(clinicId, customerId, name, phone, time, visitType) {
  const data = await must(`예약 ${name}`,
    supabase.from('reservations').insert({
      clinic_id: clinicId,
      customer_id: customerId,
      customer_name: name,
      customer_phone: phone,
      reservation_date: TARGET_DATE,
      reservation_time: time,
      visit_type: visitType,
      memo: '[TEST3]더미 — 셀프접수 테스트',
      status: 'confirmed',
    }).select('id').single()
  );
  return data.id;
}

/** 재진 고객 과거 방문 이력 (check_in, done, 예약 없음) */
async function insertPastVisit(clinicId, customerId, name, phone, daysAgo, queueNumber) {
  await must(`과거 방문 ${name}(${daysAgo}일 전)`,
    supabase.from('check_ins').insert({
      clinic_id: clinicId,
      customer_id: customerId,
      customer_name: name,
      customer_phone: phone,
      visit_type: 'returning',
      status: 'done',
      queue_number: queueNumber,
      checked_in_at: pastTs(daysAgo, 11),
      completed_at: pastTs(daysAgo, 12, 30),
      sort_order: queueNumber,
    })
  );
}

// --- Main ---
async function main() {
  console.log('🚀 셀프접수 테스트 더미 예약 삽입 시작 (T-20260514-foot-SELFCHECKIN-TESTDATA3)');

  // 클리닉 ID 확인
  const { data: clinic, error: clinicErr } = await supabase
    .from('clinics').select('id').eq('slug', 'jongno-foot').single();
  if (clinicErr || !clinic) throw new Error('clinic jongno-foot not found');
  const cid = clinic.id;
  console.log(`✅ 클리닉: ${cid}`);

  // 중복 방지 체크 — [TEST3] 010-9903-0001 존재 여부 확인
  const { data: dupCheck } = await supabase
    .from('customers')
    .select('id')
    .eq('phone', '+821099030001')
    .eq('clinic_id', cid)
    .maybeSingle();
  if (dupCheck) {
    console.log('❌ +821099030001 이미 존재 — 이미 삽입된 것으로 보입니다. 종료.');
    console.log('💡 롤백 후 재실행: rollback_selfcheckin_testdata_20260514.sql');
    process.exit(0);
  }

  let inserted = 0;

  // ==========================================================
  // 초진 10건 (visit_type: 'new', 체크인 없음)
  // ==========================================================
  console.log('\n--- 초진 10건 ---');
  const newTimes = ['10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30'];

  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    const name = `[TEST3] 초진고객${num}`;
    const phone = `+82109903${String(i).padStart(4, '0')}`;  // +821099030001 ~ +821099030010
    const time = newTimes[i - 1];

    const custId = await insertCustomer(cid, name, phone, 'new');
    await insertReservation(cid, custId, name, phone, time, 'new');
    console.log(`  ✅ ${i}. ${name} (${phone}, ${time}, new, confirmed — 체크인 없음)`);
    inserted++;
  }

  // ==========================================================
  // 재진 10건 (visit_type: 'returning', 체크인 없음, 과거 방문이력 있음)
  // ==========================================================
  console.log('\n--- 재진 10건 ---');
  const revisitTimes = ['10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30'];
  const pastDaysAgo = [30, 35, 40, 45, 50, 55, 60, 65, 70, 90];

  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    const name = `[TEST3] 재진고객${num}`;
    const phone = `+82109903${String(10 + i).padStart(4, '0')}`;  // +821099030011 ~ +821099030020
    const time = revisitTimes[i - 1];
    const daysAgo = pastDaysAgo[i - 1];

    const custId = await insertCustomer(cid, name, phone, 'returning');
    // 과거 방문 이력 (check_in)
    await insertPastVisit(cid, custId, name, phone, daysAgo, 200 + i);
    // 오늘 예약 (체크인 없음)
    await insertReservation(cid, custId, name, phone, time, 'returning');
    console.log(`  ✅ ${10 + i}. ${name} (${phone}, ${time}, returning, confirmed — 과거방문 ${daysAgo}일 전)`);
    inserted++;
  }

  console.log(`\n✅ 완료: ${inserted}/20건 삽입됨 (예약만, 체크인 없음)`);
  console.log(`📅 예약일: ${TARGET_DATE}`);
  console.log('🗑  롤백: rollback_selfcheckin_testdata_20260514.sql 실행');

  // ==========================================================
  // AC-5 검증 — phone 기준 confirmed 예약 매칭 확인
  // ==========================================================
  console.log('\n--- AC-5 검증: phone → confirmed 예약 매칭 ---');
  const testPhones = ['+821099030001', '+821099030010', '+821099030011', '+821099030020'];
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
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
