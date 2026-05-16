/**
 * 풋센터 CRM 더미데이터 30건 삽입 — 5/13 현장 테스트용
 * T-20260513-foot-DUMMY-DATA-30
 * 초진 15건 + 재진 15건 / [TEST] prefix + is_simulation=true
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const TODAY = '2026-05-13';

// --- 헬퍼 ---
function ts(hour, min = 0) {
  return `${TODAY}T${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}:00+09:00`;
}
function pastTs(daysAgo, hour, min = 0) {
  const d = new Date(`${TODAY}T00:00:00+09:00`);
  d.setDate(d.getDate() - daysAgo);
  const ds = d.toISOString().slice(0,10);
  return `${ds}T${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}:00+09:00`;
}
function pastDate(daysAgo) {
  const d = new Date(`${TODAY}T00:00:00+09:00`);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0,10);
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) {
    console.error(`❌ ${label}:`, error.message, JSON.stringify(error));
    throw new Error(`${label}: ${error.message}`);
  }
  return data;
}

async function insertCustomer(clinicId, name, phone, visitType, inflowChannel = null) {
  const payload = {
    clinic_id: clinicId,
    name,
    phone,
    visit_type: visitType,
    is_simulation: true,
  };
  if (inflowChannel) payload.inflow_channel = inflowChannel;

  const data = await must(`고객 ${name}`,
    supabase.from('customers').insert(payload).select('id').single()
  );
  return data.id;
}

async function insertPackage(clinicId, customerId, packageName, packageType, sessions) {
  const pkgMap = {
    package1:  { total: 12, heated: 12, unheated: 0,  iv: 0,  pre: 0,  amount: 3600000  },
    package2:  { total: 24, heated: 12, unheated: 12, iv: 0,  pre: 0,  amount: 6000000  },
    blelabel:  { total: 36, heated: 12, unheated: 12, iv: 12, pre: 12, amount: 8400000  },
    nopain:    { total: 48, heated: 12, unheated: 12, iv: 12, pre: 12, amount: 10800000 },
    '1month':  { total: 4,  heated: 4,  unheated: 0,  iv: 0,  pre: 0,  amount: 1200000  },
  };
  const m = pkgMap[packageType];
  const data = await must(`패키지 ${packageName}`,
    supabase.from('packages').insert({
      clinic_id: clinicId,
      customer_id: customerId,
      package_name: packageName,
      package_type: packageType,
      total_sessions: m.total,
      heated_sessions: m.heated,
      unheated_sessions: m.unheated,
      iv_sessions: m.iv,
      preconditioning_sessions: m.pre,
      total_amount: m.amount,
      paid_amount: m.amount,
      status: 'active',
      contract_date: TODAY,
    }).select('id').single()
  );
  return data.id;
}

async function insertPackageWithDate(clinicId, customerId, packageName, packageType, contractDate) {
  const pkgMap = {
    package1:  { total: 12, heated: 12, unheated: 0,  iv: 0,  pre: 0,  amount: 3600000  },
    package2:  { total: 24, heated: 12, unheated: 12, iv: 0,  pre: 0,  amount: 6000000  },
    blelabel:  { total: 36, heated: 12, unheated: 12, iv: 12, pre: 12, amount: 8400000  },
    nopain:    { total: 48, heated: 12, unheated: 12, iv: 12, pre: 12, amount: 10800000 },
  };
  const m = pkgMap[packageType];
  const data = await must(`패키지 ${packageName} (${contractDate})`,
    supabase.from('packages').insert({
      clinic_id: clinicId,
      customer_id: customerId,
      package_name: packageName,
      package_type: packageType,
      total_sessions: m.total,
      heated_sessions: m.heated,
      unheated_sessions: m.unheated,
      iv_sessions: m.iv,
      preconditioning_sessions: m.pre,
      total_amount: m.amount,
      paid_amount: m.amount,
      status: 'active',
      contract_date: contractDate,
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
      reservation_date: TODAY,
      reservation_time: time,
      visit_type: visitType,
      memo: '[TEST]더미',
      status: 'confirmed',
    }).select('id').single()
  );
  return data.id;
}

async function insertCheckIn(payload) {
  const data = await must(`체크인 ${payload.customer_name}`,
    supabase.from('check_ins').insert(payload).select('id').single()
  );
  return data.id;
}

async function insertPayment(clinicId, checkInId, customerId, amount, method = 'card') {
  await must('결제',
    supabase.from('payments').insert({
      clinic_id: clinicId,
      check_in_id: checkInId,
      customer_id: customerId,
      amount,
      method,
      payment_type: 'payment',
    })
  );
}

// --- Main ---
async function main() {
  console.log('🚀 더미데이터 삽입 시작 (T-20260513-foot-DUMMY-DATA-30)');

  // 클리닉 ID 확인
  const { data: clinic, error: clinicErr } = await supabase
    .from('clinics').select('id').eq('slug', 'jongno-foot').single();
  if (clinicErr || !clinic) throw new Error('clinic jongno-foot not found');
  const cid = clinic.id;
  console.log(`✅ 클리닉: ${cid}`);

  // 기존 [TEST] 데이터 중복 방지 체크
  const { count } = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .like('name', '[TEST]%')
    .eq('is_simulation', true);
  if (count > 0) {
    console.log(`⚠️  이미 [TEST] 고객 ${count}건 존재. 중복 체크를 위해 phone 010-9901-0001 확인...`);
    const { data: dup } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', '+821099010001')
      .eq('clinic_id', cid)
      .single();
    if (dup) {
      console.log('❌ 이미 010-9901-0001 존재 — 이미 삽입된 것으로 보입니다. 종료.');
      console.log('💡 롤백 후 재실행 하려면 rollback_dummy_20260513.sql 실행');
      process.exit(0);
    }
  }

  let inserted = 0;

  // ==========================================================
  // 초진 15건
  // ==========================================================
  console.log('\n--- 초진 15건 ---');

  // 1. 김민지 — registered 10:00
  { const id = await insertCustomer(cid, '[TEST] 김민지', '+821099010001', 'new', 'meta_ads');
    const rid = await insertReservation(cid, id, '[TEST] 김민지', '+821099010001', '10:00', 'new');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 김민지', customer_phone: '+821099010001', visit_type: 'new', status: 'registered', queue_number: 101, checked_in_at: ts(10,0), sort_order: 101 });
    console.log('  ✅ 1. 김민지 (registered)'); inserted++; }

  // 2. 이수아 — registered 10:20
  { const id = await insertCustomer(cid, '[TEST] 이수아', '+821099010002', 'new', 'naver_talk');
    const rid = await insertReservation(cid, id, '[TEST] 이수아', '+821099010002', '10:20', 'new');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 이수아', customer_phone: '+821099010002', visit_type: 'new', status: 'registered', queue_number: 102, checked_in_at: ts(10,20), sort_order: 102 });
    console.log('  ✅ 2. 이수아 (registered)'); inserted++; }

  // 3. 박지현 — registered 10:40
  { const id = await insertCustomer(cid, '[TEST] 박지현', '+821099010003', 'new', 'kakao');
    const rid = await insertReservation(cid, id, '[TEST] 박지현', '+821099010003', '10:40', 'new');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 박지현', customer_phone: '+821099010003', visit_type: 'new', status: 'registered', queue_number: 103, checked_in_at: ts(10,40), sort_order: 103 });
    console.log('  ✅ 3. 박지현 (registered)'); inserted++; }

  // 4. 정하윤 — consult_waiting 11:00
  { const id = await insertCustomer(cid, '[TEST] 정하윤', '+821099010004', 'new');
    const rid = await insertReservation(cid, id, '[TEST] 정하윤', '+821099010004', '11:00', 'new');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 정하윤', customer_phone: '+821099010004', visit_type: 'new', status: 'consult_waiting', queue_number: 104, checked_in_at: ts(11,0), sort_order: 104 });
    console.log('  ✅ 4. 정하윤 (consult_waiting)'); inserted++; }

  // 5. 최서연 — consult_waiting 11:20
  { const id = await insertCustomer(cid, '[TEST] 최서연', '+821099010005', 'new');
    const rid = await insertReservation(cid, id, '[TEST] 최서연', '+821099010005', '11:20', 'new');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 최서연', customer_phone: '+821099010005', visit_type: 'new', status: 'consult_waiting', queue_number: 105, checked_in_at: ts(11,20), sort_order: 105 });
    console.log('  ✅ 5. 최서연 (consult_waiting)'); inserted++; }

  // 6. 한예원 — consultation 상담실1 11:40
  { const id = await insertCustomer(cid, '[TEST] 한예원', '+821099010006', 'new');
    const rid = await insertReservation(cid, id, '[TEST] 한예원', '+821099010006', '11:40', 'new');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 한예원', customer_phone: '+821099010006', visit_type: 'new', status: 'consultation', queue_number: 106, checked_in_at: ts(11,40), consultation_room: '상담실1', sort_order: 106 });
    console.log('  ✅ 6. 한예원 (consultation / 상담실1)'); inserted++; }

  // 7. 윤서진 — consultation 상담실2 12:00
  { const id = await insertCustomer(cid, '[TEST] 윤서진', '+821099010007', 'new');
    const rid = await insertReservation(cid, id, '[TEST] 윤서진', '+821099010007', '12:00', 'new');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 윤서진', customer_phone: '+821099010007', visit_type: 'new', status: 'consultation', queue_number: 107, checked_in_at: ts(12,0), consultation_room: '상담실2', sort_order: 107 });
    console.log('  ✅ 7. 윤서진 (consultation / 상담실2)'); inserted++; }

  // 8. 임채원 — exam_waiting 12:20
  { const id = await insertCustomer(cid, '[TEST] 임채원', '+821099010008', 'new');
    const rid = await insertReservation(cid, id, '[TEST] 임채원', '+821099010008', '12:20', 'new');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 임채원', customer_phone: '+821099010008', visit_type: 'new', status: 'exam_waiting', queue_number: 108, checked_in_at: ts(12,20), notes: { needs_exam: true }, sort_order: 108 });
    console.log('  ✅ 8. 임채원 (exam_waiting)'); inserted++; }

  // 9. 강민서 — examination 원장실 12:40
  { const id = await insertCustomer(cid, '[TEST] 강민서', '+821099010009', 'new');
    const rid = await insertReservation(cid, id, '[TEST] 강민서', '+821099010009', '12:40', 'new');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 강민서', customer_phone: '+821099010009', visit_type: 'new', status: 'examination', queue_number: 109, checked_in_at: ts(12,40), examination_room: '원장실', notes: { needs_exam: true }, sort_order: 109 });
    console.log('  ✅ 9. 강민서 (examination / 원장실)'); inserted++; }

  // 10. 서유나 — treatment_waiting + 패키지1 13:00
  { const id = await insertCustomer(cid, '[TEST] 서유나', '+821099010010', 'new');
    const pkgId = await insertPackage(cid, id, '[TEST] 패키지1 (12회)', 'package1');
    const rid = await insertReservation(cid, id, '[TEST] 서유나', '+821099010010', '13:00', 'new');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 서유나', customer_phone: '+821099010010', visit_type: 'new', status: 'treatment_waiting', queue_number: 110, checked_in_at: ts(13,0), package_id: pkgId, sort_order: 110 });
    console.log('  ✅ 10. 서유나 (treatment_waiting / 패키지1)'); inserted++; }

  // 11. 조나현 — treatment_waiting + 패키지2 13:20
  { const id = await insertCustomer(cid, '[TEST] 조나현', '+821099010011', 'new');
    const pkgId = await insertPackage(cid, id, '[TEST] 패키지2 (24회)', 'package2');
    const rid = await insertReservation(cid, id, '[TEST] 조나현', '+821099010011', '13:20', 'new');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 조나현', customer_phone: '+821099010011', visit_type: 'new', status: 'treatment_waiting', queue_number: 111, checked_in_at: ts(13,20), package_id: pkgId, sort_order: 111 });
    console.log('  ✅ 11. 조나현 (treatment_waiting / 패키지2)'); inserted++; }

  // 12. 배수빈 — preconditioning 치료실3 + 블레라벨 13:40
  { const id = await insertCustomer(cid, '[TEST] 배수빈', '+821099010012', 'new');
    const pkgId = await insertPackage(cid, id, '[TEST] 블레라벨 (36회)', 'blelabel');
    const rid = await insertReservation(cid, id, '[TEST] 배수빈', '+821099010012', '13:40', 'new');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 배수빈', customer_phone: '+821099010012', visit_type: 'new', status: 'preconditioning', queue_number: 112, checked_in_at: ts(13,40), package_id: pkgId, treatment_room: '치료실3', sort_order: 112 });
    console.log('  ✅ 12. 배수빈 (preconditioning / 치료실3 / 블레라벨)'); inserted++; }

  // 13. 남하린 — laser_waiting + 패키지1 14:00
  { const id = await insertCustomer(cid, '[TEST] 남하린', '+821099010013', 'new');
    const pkgId = await insertPackage(cid, id, '[TEST] 패키지1 (12회)', 'package1');
    const rid = await insertReservation(cid, id, '[TEST] 남하린', '+821099010013', '14:00', 'new');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 남하린', customer_phone: '+821099010013', visit_type: 'new', status: 'laser_waiting', queue_number: 113, checked_in_at: ts(14,0), package_id: pkgId, sort_order: 113 });
    console.log('  ✅ 13. 남하린 (laser_waiting / 패키지1)'); inserted++; }

  // 14. 오지유 — laser 레이저실5 + NoPain 14:20
  { const id = await insertCustomer(cid, '[TEST] 오지유', '+821099010014', 'new');
    const pkgId = await insertPackage(cid, id, '[TEST] NoPain (48회)', 'nopain');
    const rid = await insertReservation(cid, id, '[TEST] 오지유', '+821099010014', '14:20', 'new');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 오지유', customer_phone: '+821099010014', visit_type: 'new', status: 'laser', queue_number: 114, checked_in_at: ts(14,20), package_id: pkgId, laser_room: '레이저실5', sort_order: 114 });
    console.log('  ✅ 14. 오지유 (laser / 레이저실5 / NoPain)'); inserted++; }

  // 15. 신예진 — done + 패키지2 + 결제 14:40
  { const id = await insertCustomer(cid, '[TEST] 신예진', '+821099010015', 'new');
    const pkgId = await insertPackage(cid, id, '[TEST] 패키지2 (24회)', 'package2');
    const rid = await insertReservation(cid, id, '[TEST] 신예진', '+821099010015', '14:40', 'new');
    const ciId = await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 신예진', customer_phone: '+821099010015', visit_type: 'new', status: 'done', queue_number: 115, checked_in_at: ts(14,40), package_id: pkgId, completed_at: ts(16,0), sort_order: 115 });
    await insertPayment(cid, ciId, id, 6000000, 'card');
    console.log('  ✅ 15. 신예진 (done / 패키지2 / 결제 완료)'); inserted++; }

  // ==========================================================
  // 재진 15건 (+ 과거 방문 이력)
  // ==========================================================
  console.log('\n--- 재진 15건 ---');

  // 16. 김태민 — registered + 패키지2 (30일 전 계약) 10:10
  { const id = await insertCustomer(cid, '[TEST] 김태민', '+821099010016', 'returning');
    const pkgId = await insertPackageWithDate(cid, id, '[TEST] 패키지2 (24회)', 'package2', pastDate(30));
    // 과거 방문 이력
    await insertCheckIn({ clinic_id: cid, customer_id: id, customer_name: '[TEST] 김태민', customer_phone: '+821099010016', visit_type: 'returning', status: 'done', queue_number: 51, checked_in_at: pastTs(30,11), package_id: pkgId, completed_at: pastTs(30,12,30), sort_order: 51 });
    const rid = await insertReservation(cid, id, '[TEST] 김태민', '+821099010016', '10:10', 'returning');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 김태민', customer_phone: '+821099010016', visit_type: 'returning', status: 'registered', queue_number: 116, checked_in_at: ts(10,10), package_id: pkgId, sort_order: 116 });
    console.log('  ✅ 16. 김태민 (registered / 재진 / 패키지2)'); inserted++; }

  // 17. 이도현 — registered + 블레라벨 (45일 전) 10:30
  { const id = await insertCustomer(cid, '[TEST] 이도현', '+821099010017', 'returning');
    const pkgId = await insertPackageWithDate(cid, id, '[TEST] 블레라벨 (36회)', 'blelabel', pastDate(45));
    await insertCheckIn({ clinic_id: cid, customer_id: id, customer_name: '[TEST] 이도현', customer_phone: '+821099010017', visit_type: 'returning', status: 'done', queue_number: 52, checked_in_at: pastTs(45,14), package_id: pkgId, completed_at: pastTs(45,15,30), sort_order: 52 });
    const rid = await insertReservation(cid, id, '[TEST] 이도현', '+821099010017', '10:30', 'returning');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 이도현', customer_phone: '+821099010017', visit_type: 'returning', status: 'registered', queue_number: 117, checked_in_at: ts(10,30), package_id: pkgId, sort_order: 117 });
    console.log('  ✅ 17. 이도현 (registered / 재진 / 블레라벨)'); inserted++; }

  // 18. 박준혁 — registered + NoPain (60일 전) 10:50
  { const id = await insertCustomer(cid, '[TEST] 박준혁', '+821099010018', 'returning');
    const pkgId = await insertPackageWithDate(cid, id, '[TEST] NoPain (48회)', 'nopain', pastDate(60));
    await insertCheckIn({ clinic_id: cid, customer_id: id, customer_name: '[TEST] 박준혁', customer_phone: '+821099010018', visit_type: 'returning', status: 'done', queue_number: 53, checked_in_at: pastTs(60,10), package_id: pkgId, completed_at: pastTs(60,11,30), sort_order: 53 });
    const rid = await insertReservation(cid, id, '[TEST] 박준혁', '+821099010018', '10:50', 'returning');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 박준혁', customer_phone: '+821099010018', visit_type: 'returning', status: 'registered', queue_number: 118, checked_in_at: ts(10,50), package_id: pkgId, sort_order: 118 });
    console.log('  ✅ 18. 박준혁 (registered / 재진 / NoPain)'); inserted++; }

  // 19. 정시원 — treatment_waiting + 패키지1 (14일 전) 11:10
  { const id = await insertCustomer(cid, '[TEST] 정시원', '+821099010019', 'returning');
    const pkgId = await insertPackageWithDate(cid, id, '[TEST] 패키지1 (12회)', 'package1', pastDate(14));
    await insertCheckIn({ clinic_id: cid, customer_id: id, customer_name: '[TEST] 정시원', customer_phone: '+821099010019', visit_type: 'returning', status: 'done', queue_number: 54, checked_in_at: pastTs(14,11), package_id: pkgId, completed_at: pastTs(14,12), sort_order: 54 });
    const rid = await insertReservation(cid, id, '[TEST] 정시원', '+821099010019', '11:10', 'returning');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 정시원', customer_phone: '+821099010019', visit_type: 'returning', status: 'treatment_waiting', queue_number: 119, checked_in_at: ts(11,10), package_id: pkgId, sort_order: 119 });
    console.log('  ✅ 19. 정시원 (treatment_waiting / 재진 / 패키지1)'); inserted++; }

  // 20. 최우진 — treatment_waiting + 블레라벨 (20일 전) 11:30
  { const id = await insertCustomer(cid, '[TEST] 최우진', '+821099010020', 'returning');
    const pkgId = await insertPackageWithDate(cid, id, '[TEST] 블레라벨 (36회)', 'blelabel', pastDate(20));
    await insertCheckIn({ clinic_id: cid, customer_id: id, customer_name: '[TEST] 최우진', customer_phone: '+821099010020', visit_type: 'returning', status: 'done', queue_number: 55, checked_in_at: pastTs(20,13), package_id: pkgId, completed_at: pastTs(20,14,30), sort_order: 55 });
    const rid = await insertReservation(cid, id, '[TEST] 최우진', '+821099010020', '11:30', 'returning');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 최우진', customer_phone: '+821099010020', visit_type: 'returning', status: 'treatment_waiting', queue_number: 120, checked_in_at: ts(11,30), package_id: pkgId, sort_order: 120 });
    console.log('  ✅ 20. 최우진 (treatment_waiting / 재진 / 블레라벨)'); inserted++; }

  // 21. 한재원 — treatment_waiting + NoPain (90일 전) 11:50
  { const id = await insertCustomer(cid, '[TEST] 한재원', '+821099010021', 'returning');
    const pkgId = await insertPackageWithDate(cid, id, '[TEST] NoPain (48회)', 'nopain', pastDate(90));
    await insertCheckIn({ clinic_id: cid, customer_id: id, customer_name: '[TEST] 한재원', customer_phone: '+821099010021', visit_type: 'returning', status: 'done', queue_number: 56, checked_in_at: pastTs(90,11), package_id: pkgId, completed_at: pastTs(90,12,30), sort_order: 56 });
    const rid = await insertReservation(cid, id, '[TEST] 한재원', '+821099010021', '11:50', 'returning');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 한재원', customer_phone: '+821099010021', visit_type: 'returning', status: 'treatment_waiting', queue_number: 121, checked_in_at: ts(11,50), package_id: pkgId, sort_order: 121 });
    console.log('  ✅ 21. 한재원 (treatment_waiting / 재진 / NoPain)'); inserted++; }

  // 22. 윤성민 — preconditioning 치료실6 + 패키지2 (35일 전) 12:10
  { const id = await insertCustomer(cid, '[TEST] 윤성민', '+821099010022', 'returning');
    const pkgId = await insertPackageWithDate(cid, id, '[TEST] 패키지2 (24회)', 'package2', pastDate(35));
    await insertCheckIn({ clinic_id: cid, customer_id: id, customer_name: '[TEST] 윤성민', customer_phone: '+821099010022', visit_type: 'returning', status: 'done', queue_number: 57, checked_in_at: pastTs(35,12), package_id: pkgId, completed_at: pastTs(35,13,30), sort_order: 57 });
    const rid = await insertReservation(cid, id, '[TEST] 윤성민', '+821099010022', '12:10', 'returning');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 윤성민', customer_phone: '+821099010022', visit_type: 'returning', status: 'preconditioning', queue_number: 122, checked_in_at: ts(12,10), package_id: pkgId, treatment_room: '치료실6', sort_order: 122 });
    console.log('  ✅ 22. 윤성민 (preconditioning / 치료실6 / 패키지2)'); inserted++; }

  // 23. 임지호 — preconditioning 치료실8 + 블레라벨 (50일 전) 12:30
  { const id = await insertCustomer(cid, '[TEST] 임지호', '+821099010023', 'returning');
    const pkgId = await insertPackageWithDate(cid, id, '[TEST] 블레라벨 (36회)', 'blelabel', pastDate(50));
    await insertCheckIn({ clinic_id: cid, customer_id: id, customer_name: '[TEST] 임지호', customer_phone: '+821099010023', visit_type: 'returning', status: 'done', queue_number: 58, checked_in_at: pastTs(50,14), package_id: pkgId, completed_at: pastTs(50,15,30), sort_order: 58 });
    const rid = await insertReservation(cid, id, '[TEST] 임지호', '+821099010023', '12:30', 'returning');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 임지호', customer_phone: '+821099010023', visit_type: 'returning', status: 'preconditioning', queue_number: 123, checked_in_at: ts(12,30), package_id: pkgId, treatment_room: '치료실8', sort_order: 123 });
    console.log('  ✅ 23. 임지호 (preconditioning / 치료실8 / 블레라벨)'); inserted++; }

  // 24. 강찬호 — laser_waiting + 패키지1 (7일 전) 12:50
  { const id = await insertCustomer(cid, '[TEST] 강찬호', '+821099010024', 'returning');
    const pkgId = await insertPackageWithDate(cid, id, '[TEST] 패키지1 (12회)', 'package1', pastDate(7));
    await insertCheckIn({ clinic_id: cid, customer_id: id, customer_name: '[TEST] 강찬호', customer_phone: '+821099010024', visit_type: 'returning', status: 'done', queue_number: 59, checked_in_at: pastTs(7,10), package_id: pkgId, completed_at: pastTs(7,11,30), sort_order: 59 });
    const rid = await insertReservation(cid, id, '[TEST] 강찬호', '+821099010024', '12:50', 'returning');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 강찬호', customer_phone: '+821099010024', visit_type: 'returning', status: 'laser_waiting', queue_number: 124, checked_in_at: ts(12,50), package_id: pkgId, sort_order: 124 });
    console.log('  ✅ 24. 강찬호 (laser_waiting / 패키지1)'); inserted++; }

  // 25. 서민재 — laser_waiting + NoPain (25일 전) 13:10
  { const id = await insertCustomer(cid, '[TEST] 서민재', '+821099010025', 'returning');
    const pkgId = await insertPackageWithDate(cid, id, '[TEST] NoPain (48회)', 'nopain', pastDate(25));
    await insertCheckIn({ clinic_id: cid, customer_id: id, customer_name: '[TEST] 서민재', customer_phone: '+821099010025', visit_type: 'returning', status: 'done', queue_number: 60, checked_in_at: pastTs(25,15), package_id: pkgId, completed_at: pastTs(25,16,30), sort_order: 60 });
    const rid = await insertReservation(cid, id, '[TEST] 서민재', '+821099010025', '13:10', 'returning');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 서민재', customer_phone: '+821099010025', visit_type: 'returning', status: 'laser_waiting', queue_number: 125, checked_in_at: ts(13,10), package_id: pkgId, sort_order: 125 });
    console.log('  ✅ 25. 서민재 (laser_waiting / NoPain)'); inserted++; }

  // 26. 조현우 — laser 레이저실2 + 패키지2 (40일 전) 13:30
  { const id = await insertCustomer(cid, '[TEST] 조현우', '+821099010026', 'returning');
    const pkgId = await insertPackageWithDate(cid, id, '[TEST] 패키지2 (24회)', 'package2', pastDate(40));
    await insertCheckIn({ clinic_id: cid, customer_id: id, customer_name: '[TEST] 조현우', customer_phone: '+821099010026', visit_type: 'returning', status: 'done', queue_number: 61, checked_in_at: pastTs(40,13), package_id: pkgId, completed_at: pastTs(40,14,30), sort_order: 61 });
    const rid = await insertReservation(cid, id, '[TEST] 조현우', '+821099010026', '13:30', 'returning');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 조현우', customer_phone: '+821099010026', visit_type: 'returning', status: 'laser', queue_number: 126, checked_in_at: ts(13,30), package_id: pkgId, laser_room: '레이저실2', sort_order: 126 });
    console.log('  ✅ 26. 조현우 (laser / 레이저실2 / 패키지2)'); inserted++; }

  // 27. 배주원 — laser 레이저실4 + 블레라벨 (55일 전) 13:50
  { const id = await insertCustomer(cid, '[TEST] 배주원', '+821099010027', 'returning');
    const pkgId = await insertPackageWithDate(cid, id, '[TEST] 블레라벨 (36회)', 'blelabel', pastDate(55));
    await insertCheckIn({ clinic_id: cid, customer_id: id, customer_name: '[TEST] 배주원', customer_phone: '+821099010027', visit_type: 'returning', status: 'done', queue_number: 62, checked_in_at: pastTs(55,11), package_id: pkgId, completed_at: pastTs(55,12,30), sort_order: 62 });
    const rid = await insertReservation(cid, id, '[TEST] 배주원', '+821099010027', '13:50', 'returning');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 배주원', customer_phone: '+821099010027', visit_type: 'returning', status: 'laser', queue_number: 127, checked_in_at: ts(13,50), package_id: pkgId, laser_room: '레이저실4', sort_order: 127 });
    console.log('  ✅ 27. 배주원 (laser / 레이저실4 / 블레라벨)'); inserted++; }

  // 28. 남유진 — laser 레이저실9 + NoPain (70일 전) 14:10
  { const id = await insertCustomer(cid, '[TEST] 남유진', '+821099010028', 'returning');
    const pkgId = await insertPackageWithDate(cid, id, '[TEST] NoPain (48회)', 'nopain', pastDate(70));
    await insertCheckIn({ clinic_id: cid, customer_id: id, customer_name: '[TEST] 남유진', customer_phone: '+821099010028', visit_type: 'returning', status: 'done', queue_number: 63, checked_in_at: pastTs(70,10), package_id: pkgId, completed_at: pastTs(70,11,30), sort_order: 63 });
    const rid = await insertReservation(cid, id, '[TEST] 남유진', '+821099010028', '14:10', 'returning');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 남유진', customer_phone: '+821099010028', visit_type: 'returning', status: 'laser', queue_number: 128, checked_in_at: ts(14,10), package_id: pkgId, laser_room: '레이저실9', sort_order: 128 });
    console.log('  ✅ 28. 남유진 (laser / 레이저실9 / NoPain)'); inserted++; }

  // 29. 오민준 — payment_waiting + 패키지1 (10일 전) 14:30
  { const id = await insertCustomer(cid, '[TEST] 오민준', '+821099010029', 'returning');
    const pkgId = await insertPackageWithDate(cid, id, '[TEST] 패키지1 (12회)', 'package1', pastDate(10));
    await insertCheckIn({ clinic_id: cid, customer_id: id, customer_name: '[TEST] 오민준', customer_phone: '+821099010029', visit_type: 'returning', status: 'done', queue_number: 64, checked_in_at: pastTs(10,14), package_id: pkgId, completed_at: pastTs(10,15,30), sort_order: 64 });
    const rid = await insertReservation(cid, id, '[TEST] 오민준', '+821099010029', '14:30', 'returning');
    await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 오민준', customer_phone: '+821099010029', visit_type: 'returning', status: 'payment_waiting', queue_number: 129, checked_in_at: ts(14,30), package_id: pkgId, sort_order: 129 });
    console.log('  ✅ 29. 오민준 (payment_waiting / 패키지1)'); inserted++; }

  // 30. 신서하 — done + 블레라벨 + 결제 (80일 전 계약) 15:00
  { const id = await insertCustomer(cid, '[TEST] 신서하', '+821099010030', 'returning');
    const pkgId = await insertPackageWithDate(cid, id, '[TEST] 블레라벨 (36회)', 'blelabel', pastDate(80));
    await insertCheckIn({ clinic_id: cid, customer_id: id, customer_name: '[TEST] 신서하', customer_phone: '+821099010030', visit_type: 'returning', status: 'done', queue_number: 65, checked_in_at: pastTs(80,13), package_id: pkgId, completed_at: pastTs(80,14,30), sort_order: 65 });
    const rid = await insertReservation(cid, id, '[TEST] 신서하', '+821099010030', '15:00', 'returning');
    const ciId = await insertCheckIn({ clinic_id: cid, customer_id: id, reservation_id: rid, customer_name: '[TEST] 신서하', customer_phone: '+821099010030', visit_type: 'returning', status: 'done', queue_number: 130, checked_in_at: ts(15,0), package_id: pkgId, completed_at: ts(17,0), sort_order: 130 });
    await insertPayment(cid, ciId, id, 0, 'card');  // 패키지 선납
    console.log('  ✅ 30. 신서하 (done / 블레라벨 / 결제 완료)'); inserted++; }

  console.log(`\n✅ 완료: ${inserted}/30건 삽입됨`);
  console.log('🗑  롤백 명령어: rollback_dummy_20260513.sql 실행');
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
