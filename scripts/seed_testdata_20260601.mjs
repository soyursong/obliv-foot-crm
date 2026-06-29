/**
 * 풋센터 CRM 더미 데이터 — 6/1 현장 테스트용
 * 요청자: 김주연 총괄 (slack thread_ts: 1780269738.139479)
 *
 * 구성: 고객 84명 (초진 42명 + 재진 42명) × 1슬롯씩 = 예약 84건
 *   - 초진 42명 (채소이름): 슬롯당 2명 × 21슬롯(10:00~20:00, 30분 간격) = 42건
 *   - 재진 42명 (색깔이름): 슬롯당 2명 × 21슬롯 = 42건
 *   - 재진 42명: 2026-05-01 과거 체크인 1건씩 (재진 판별 충족)
 * 전화번호:
 *   - 초진(채소): +821099070001 ~ +821099070042
 *   - 재진(색깔): +821099070043 ~ +821099070084
 * 마킹: is_simulation=true, memo 태그 [testdata_20260601]
 * 정리: node scripts/rollback_testdata_20260601.mjs
 */

import { createClient } from '@supabase/supabase-js';

const TARGET_DATE = '2026-06-01';
const PAST_DATE   = '2026-05-01';
const SEED_TAG    = 'testdata_20260601';

// 10:00 ~ 20:00 (30분 간격, 21슬롯)
const SLOTS = [
  '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30',
  '20:00',
];

// 초진 — 채소이름 42개 (슬롯당 2명)
const VEGGIES_NEW = [
  // 10:00 슬롯
  { name: '당근',         phone: '+821099070001' },
  { name: '시금치',       phone: '+821099070002' },
  // 10:30 슬롯
  { name: '양배추',       phone: '+821099070003' },
  { name: '고추',         phone: '+821099070004' },
  // 11:00 슬롯
  { name: '대파',         phone: '+821099070005' },
  { name: '마늘',         phone: '+821099070006' },
  // 11:30 슬롯
  { name: '상추',         phone: '+821099070007' },
  { name: '오이',         phone: '+821099070008' },
  // 12:00 슬롯
  { name: '애호박',       phone: '+821099070009' },
  { name: '가지',         phone: '+821099070010' },
  // 12:30 슬롯
  { name: '배추',         phone: '+821099070011' },
  { name: '무',           phone: '+821099070012' },
  // 13:00 슬롯
  { name: '아스파라거스', phone: '+821099070013' },
  { name: '셀러리',       phone: '+821099070014' },
  // 13:30 슬롯
  { name: '파프리카',     phone: '+821099070015' },
  { name: '피망',         phone: '+821099070016' },
  // 14:00 슬롯
  { name: '부추',         phone: '+821099070017' },
  { name: '미나리',       phone: '+821099070018' },
  // 14:30 슬롯
  { name: '쑥갓',         phone: '+821099070019' },
  { name: '깻잎',         phone: '+821099070020' },
  // 15:00 슬롯
  { name: '도라지',       phone: '+821099070021' },
  { name: '더덕',         phone: '+821099070022' },
  // 15:30 슬롯
  { name: '연근',         phone: '+821099070023' },
  { name: '우엉',         phone: '+821099070024' },
  // 16:00 슬롯
  { name: '토란',         phone: '+821099070025' },
  { name: '감자',         phone: '+821099070026' },
  // 16:30 슬롯
  { name: '고구마',       phone: '+821099070027' },
  { name: '양파',         phone: '+821099070028' },
  // 17:00 슬롯
  { name: '생강',         phone: '+821099070029' },
  { name: '콩나물',       phone: '+821099070030' },
  // 17:30 슬롯
  { name: '숙주',         phone: '+821099070031' },
  { name: '두릅',         phone: '+821099070032' },
  // 18:00 슬롯
  { name: '머위',         phone: '+821099070033' },
  { name: '냉이',         phone: '+821099070034' },
  // 18:30 슬롯
  { name: '달래',         phone: '+821099070035' },
  { name: '봄동',         phone: '+821099070036' },
  // 19:00 슬롯
  { name: '청경채',       phone: '+821099070037' },
  { name: '로메인',       phone: '+821099070038' },
  // 19:30 슬롯
  { name: '루꼴라',       phone: '+821099070039' },
  { name: '바질',         phone: '+821099070040' },
  // 20:00 슬롯
  { name: '케일',         phone: '+821099070041' },
  { name: '치커리',       phone: '+821099070042' },
];

// 재진 — 색깔이름 42개 (슬롯당 2명)
const COLORS_RET = [
  // 10:00 슬롯
  { name: '빨강',         phone: '+821099070043' },
  { name: '주황',         phone: '+821099070044' },
  // 10:30 슬롯
  { name: '노랑',         phone: '+821099070045' },
  { name: '초록',         phone: '+821099070046' },
  // 11:00 슬롯
  { name: '파랑',         phone: '+821099070047' },
  { name: '남색',         phone: '+821099070048' },
  // 11:30 슬롯
  { name: '보라',         phone: '+821099070049' },
  { name: '분홍',         phone: '+821099070050' },
  // 12:00 슬롯
  { name: '하늘',         phone: '+821099070051' },
  { name: '민트',         phone: '+821099070052' },
  // 12:30 슬롯
  { name: '갈색',         phone: '+821099070053' },
  { name: '회색',         phone: '+821099070054' },
  // 13:00 슬롯
  { name: '검정',         phone: '+821099070055' },
  { name: '흰색',         phone: '+821099070056' },
  // 13:30 슬롯
  { name: '연두',         phone: '+821099070057' },
  { name: '자주',         phone: '+821099070058' },
  // 14:00 슬롯
  { name: '자홍',         phone: '+821099070059' },
  { name: '청록',         phone: '+821099070060' },
  // 14:30 슬롯
  { name: '베이지',       phone: '+821099070061' },
  { name: '살구',         phone: '+821099070062' },
  // 15:00 슬롯
  { name: '라벤더',       phone: '+821099070063' },
  { name: '크림',         phone: '+821099070064' },
  // 15:30 슬롯
  { name: '연보라',       phone: '+821099070065' },
  { name: '진파랑',       phone: '+821099070066' },
  // 16:00 슬롯
  { name: '진초록',       phone: '+821099070067' },
  { name: '카키',         phone: '+821099070068' },
  // 16:30 슬롯
  { name: '금색',         phone: '+821099070069' },
  { name: '은색',         phone: '+821099070070' },
  // 17:00 슬롯
  { name: '청색',         phone: '+821099070071' },
  { name: '홍색',         phone: '+821099070072' },
  // 17:30 슬롯
  { name: '황색',         phone: '+821099070073' },
  { name: '흑색',         phone: '+821099070074' },
  // 18:00 슬롯
  { name: '장밋빛',       phone: '+821099070075' },
  { name: '산호',         phone: '+821099070076' },
  // 18:30 슬롯
  { name: '코랄',         phone: '+821099070077' },
  { name: '마젠타',       phone: '+821099070078' },
  // 19:00 슬롯
  { name: '터콰이즈',     phone: '+821099070079' },
  { name: '인디고',       phone: '+821099070080' },
  // 19:30 슬롯
  { name: '샐몬',         phone: '+821099070081' },
  { name: '아이보리',     phone: '+821099070082' },
  // 20:00 슬롯
  { name: '올리브',       phone: '+821099070083' },
  { name: '네이비',       phone: '+821099070084' },
];

const SUPABASE_URL     = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) {
    console.error(`❌ ${label}:`, error.message, JSON.stringify(error));
    throw new Error(`${label}: ${error.message}`);
  }
  return data;
}

async function main() {
  console.log('🚀 더미 데이터 삽입 시작 (6/1 현장 테스트 — 고객 84명 × 1슬롯)');
  console.log(`   날짜: ${TARGET_DATE}`);
  console.log(`   초진(채소): ${VEGGIES_NEW.length}명, 재진(색깔): ${COLORS_RET.length}명`);
  console.log(`   슬롯: ${SLOTS.length}개 (${SLOTS[0]}~${SLOTS[SLOTS.length - 1]}, 30분 간격), 슬롯당 2초진+2재진`);
  console.log(`   예상 예약: ${VEGGIES_NEW.length + COLORS_RET.length}건`);

  // 클리닉 조회
  const clinic = await must('클리닉 조회',
    supabase.from('clinics').select('id').eq('slug', 'jongno-foot').single()
  );
  const clinicId = clinic.id;
  console.log(`\n✅ 클리닉 ID: ${clinicId}`);

  // 중복 방지 체크 (전화번호 기준)
  const allPhones = [...VEGGIES_NEW, ...COLORS_RET].map(c => c.phone);
  const { data: dupCheck } = await supabase
    .from('customers')
    .select('id,name,phone')
    .in('phone', allPhones)
    .eq('is_simulation', true);
  if (dupCheck && dupCheck.length > 0) {
    const existingNames = dupCheck.map(c => `${c.name}(${c.phone})`).join(', ');
    console.warn(`⚠️  테스트 데이터가 이미 존재합니다: ${existingNames}`);
    console.warn('   롤백 후 재실행하세요: node scripts/rollback_testdata_20260601.mjs');
    process.exit(1);
  }

  let totalCustomers = 0;
  let totalResvNew   = 0;
  let totalResvRet   = 0;
  let totalPastCI    = 0;

  // ── 초진 42명 생성 (채소이름) ────────────────────────────────
  console.log('\n── 초진 고객 생성 (채소이름 42명) ───────────────────────');
  for (let i = 0; i < VEGGIES_NEW.length; i++) {
    const veggie = VEGGIES_NEW[i];
    const slot   = SLOTS[Math.floor(i / 2)]; // 2명마다 슬롯 1개

    const cust = await must(`고객(초진) ${veggie.name}`,
      supabase.from('customers').insert({
        clinic_id:      clinicId,
        name:           veggie.name,
        phone:          veggie.phone,
        visit_type:     'new',
        is_simulation:  true,
        inflow_channel: 'meta_ads',
      }).select('id').single()
    );
    totalCustomers++;

    await must(`예약(초진) ${veggie.name} ${slot}`,
      supabase.from('reservations').insert({
        clinic_id:        clinicId,
        customer_id:      cust.id,
        customer_name:    veggie.name,
        customer_phone:   veggie.phone,
        reservation_date: TARGET_DATE,
        reservation_time: slot,
        visit_type:       'new',
        memo:             `더미 | 초진 ${slot} [${SEED_TAG}]`,
        status:           'confirmed',
      })
    );
    totalResvNew++;
    console.log(`  ✔ ${veggie.name} (${veggie.phone}) → ${slot} 예약`);
  }

  // ── 재진 42명 생성 (색깔이름) ────────────────────────────────
  console.log('\n── 재진 고객 생성 (색깔이름 42명) ───────────────────────');
  for (let i = 0; i < COLORS_RET.length; i++) {
    const color  = COLORS_RET[i];
    const slot   = SLOTS[Math.floor(i / 2)]; // 2명마다 슬롯 1개
    const queueNum = 9400 + i;

    const cust = await must(`고객(재진) ${color.name}`,
      supabase.from('customers').insert({
        clinic_id:      clinicId,
        name:           color.name,
        phone:          color.phone,
        visit_type:     'returning',
        is_simulation:  true,
        inflow_channel: 'returning',
      }).select('id').single()
    );
    totalCustomers++;

    // 재진 판별용 과거 체크인 1건
    await must(`과거체크인(재진) ${color.name}`,
      supabase.from('check_ins').insert({
        clinic_id:      clinicId,
        customer_id:    cust.id,
        customer_name:  color.name,
        customer_phone: color.phone,
        visit_type:     'returning',
        status:         'done',
        queue_number:   queueNum,
        checked_in_at:  `${PAST_DATE}T10:00:00+09:00`,
        completed_at:   `${PAST_DATE}T11:30:00+09:00`,
        sort_order:     queueNum,
        notes:          JSON.stringify({ seed: SEED_TAG, past_checkin: true }),
      })
    );
    totalPastCI++;

    await must(`예약(재진) ${color.name} ${slot}`,
      supabase.from('reservations').insert({
        clinic_id:        clinicId,
        customer_id:      cust.id,
        customer_name:    color.name,
        customer_phone:   color.phone,
        reservation_date: TARGET_DATE,
        reservation_time: slot,
        visit_type:       'returning',
        memo:             `더미 | 재진 ${slot} [${SEED_TAG}]`,
        status:           'confirmed',
      })
    );
    totalResvRet++;
    console.log(`  ✔ ${color.name} (${color.phone}) → ${slot} 예약 + 과거체크인`);
  }

  console.log('\n════════════════════════════════════════════════════════');
  console.log(`✅ 더미 데이터 삽입 완료 (6/1 — 고객 84명 × 1슬롯)`);
  console.log(`   고객:       ${totalCustomers}명 (초진 ${VEGGIES_NEW.length}명 + 재진 ${COLORS_RET.length}명)`);
  console.log(`   예약:       초진 ${totalResvNew}건 + 재진 ${totalResvRet}건 = ${totalResvNew + totalResvRet}건`);
  console.log(`   과거체크인: ${totalPastCI}건 (${PAST_DATE}, 재진 판별용)`);
  console.log('\n── 슬롯별 분포 ──────────────────────────────────────────');
  SLOTS.forEach((slot, i) => {
    const newNames = VEGGIES_NEW.slice(i * 2, i * 2 + 2).map(v => v.name).join('·');
    const retNames = COLORS_RET.slice(i * 2, i * 2 + 2).map(c => c.name).join('·');
    console.log(`  ${slot}: 초진[${newNames}] 재진[${retNames}]`);
  });
  console.log('\n── 셀프접수 테스트 번호 ──────────────────────────────────');
  console.log('  초진(채소): 010-9907-0001 ~ 010-9907-0042');
  console.log('  재진(색깔): 010-9907-0043 ~ 010-9907-0084');
  console.log('\n── 정리 (테스트 후) ─────────────────────────────────────');
  console.log('   node scripts/rollback_testdata_20260601.mjs');
  console.log('════════════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
