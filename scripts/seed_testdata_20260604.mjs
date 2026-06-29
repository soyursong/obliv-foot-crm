/**
 * 풋센터 CRM 더미 데이터 — 6/4 익일 테스트용
 * T-20260603-foot-DUMMY-RESV-0604
 *
 * 구성: 고객 68명 (초진 34명 + 재진 34명) × 1슬롯씩 = 예약 68건
 *   - 초진 34명 (과일이름): 슬롯당 2명 × 17슬롯(11:00~19:00, 30분간격) = 34건
 *   - 재진 34명 (동물이름): 슬롯당 2명 × 17슬롯(11:00~19:00, 30분간격) = 34건
 *   - 재진 34명: 2026-06-01 과거 체크인 1건씩 (재진 판별 충족)
 * 전화번호:
 *   - 초진(과일): +821000003001 ~ +821000003034
 *   - 재진(동물): +821000003035 ~ +821000003068
 * 마킹: is_simulation=true, memo에 [testdata_20260604] 태그
 * 정리: node scripts/rollback_testdata_20260604.mjs
 */

import { createClient } from '@supabase/supabase-js';

const TARGET_DATE = '2026-06-04';
const PAST_DATE   = '2026-06-01';
const SEED_TAG    = 'testdata_20260604';

// 11:00 ~ 19:00, 30분 간격 (17개 슬롯)
const SLOTS = [
  '11:00', '11:30',
  '12:00', '12:30',
  '13:00', '13:30',
  '14:00', '14:30',
  '15:00', '15:30',
  '16:00', '16:30',
  '17:00', '17:30',
  '18:00', '18:30',
  '19:00',
];

// 초진 — 과일이름 34명 (슬롯당 2명: indices 0-1, 2-3, ..., 32-33)
const FRUITS_NEW = [
  // 11:00 슬롯
  { name: '사과',       phone: '+821000003001' },
  { name: '딸기',       phone: '+821000003002' },
  // 11:30 슬롯
  { name: '포도',       phone: '+821000003003' },
  { name: '바나나',     phone: '+821000003004' },
  // 12:00 슬롯
  { name: '수박',       phone: '+821000003005' },
  { name: '키위',       phone: '+821000003006' },
  // 12:30 슬롯
  { name: '망고',       phone: '+821000003007' },
  { name: '복숭아',     phone: '+821000003008' },
  // 13:00 슬롯
  { name: '자두',       phone: '+821000003009' },
  { name: '블루베리',   phone: '+821000003010' },
  // 13:30 슬롯
  { name: '체리',       phone: '+821000003011' },
  { name: '레몬',       phone: '+821000003012' },
  // 14:00 슬롯
  { name: '오렌지',     phone: '+821000003013' },
  { name: '라임',       phone: '+821000003014' },
  // 14:30 슬롯
  { name: '파인애플',   phone: '+821000003015' },
  { name: '코코넛',     phone: '+821000003016' },
  // 15:00 슬롯
  { name: '석류',       phone: '+821000003017' },
  { name: '감',         phone: '+821000003018' },
  // 15:30 슬롯
  { name: '배',         phone: '+821000003019' },
  { name: '귤',         phone: '+821000003020' },
  // 16:00 슬롯
  { name: '매실',       phone: '+821000003021' },
  { name: '살구',       phone: '+821000003022' },
  // 16:30 슬롯
  { name: '참외',       phone: '+821000003023' },
  { name: '멜론',       phone: '+821000003024' },
  // 17:00 슬롯
  { name: '용과',       phone: '+821000003025' },
  { name: '구아바',     phone: '+821000003026' },
  // 17:30 슬롯
  { name: '리치',       phone: '+821000003027' },
  { name: '무화과',     phone: '+821000003028' },
  // 18:00 슬롯
  { name: '패션프루트', phone: '+821000003029' },
  { name: '아보카도',   phone: '+821000003030' },
  // 18:30 슬롯
  { name: '두리안',     phone: '+821000003031' },
  { name: '파파야',     phone: '+821000003032' },
  // 19:00 슬롯
  { name: '유자',       phone: '+821000003033' },
  { name: '산딸기',     phone: '+821000003034' },
];

// 재진 — 동물이름 34명 (슬롯당 2명: indices 0-1, 2-3, ..., 32-33)
const ANIMALS_RET = [
  // 11:00 슬롯
  { name: '고양이',   phone: '+821000003035' },
  { name: '강아지',   phone: '+821000003036' },
  // 11:30 슬롯
  { name: '토끼',     phone: '+821000003037' },
  { name: '사자',     phone: '+821000003038' },
  // 12:00 슬롯
  { name: '호랑이',   phone: '+821000003039' },
  { name: '코끼리',   phone: '+821000003040' },
  // 12:30 슬롯
  { name: '기린',     phone: '+821000003041' },
  { name: '펭귄',     phone: '+821000003042' },
  // 13:00 슬롯
  { name: '올빼미',   phone: '+821000003043' },
  { name: '독수리',   phone: '+821000003044' },
  // 13:30 슬롯
  { name: '돌고래',   phone: '+821000003045' },
  { name: '하마',     phone: '+821000003046' },
  // 14:00 슬롯
  { name: '악어',     phone: '+821000003047' },
  { name: '판다',     phone: '+821000003048' },
  // 14:30 슬롯
  { name: '여우',     phone: '+821000003049' },
  { name: '늑대',     phone: '+821000003050' },
  // 15:00 슬롯
  { name: '수달',     phone: '+821000003051' },
  { name: '두루미',   phone: '+821000003052' },
  // 15:30 슬롯
  { name: '참새',     phone: '+821000003053' },
  { name: '까치',     phone: '+821000003054' },
  // 16:00 슬롯
  { name: '부엉이',   phone: '+821000003055' },
  { name: '매',       phone: '+821000003056' },
  // 16:30 슬롯
  { name: '오리',     phone: '+821000003057' },
  { name: '거위',     phone: '+821000003058' },
  // 17:00 슬롯
  { name: '백조',     phone: '+821000003059' },
  { name: '원숭이',   phone: '+821000003060' },
  // 17:30 슬롯
  { name: '다람쥐',   phone: '+821000003061' },
  { name: '고슴도치', phone: '+821000003062' },
  // 18:00 슬롯
  { name: '낙타',     phone: '+821000003063' },
  { name: '물개',     phone: '+821000003064' },
  // 18:30 슬롯
  { name: '해달',     phone: '+821000003065' },
  { name: '북극곰',   phone: '+821000003066' },
  // 19:00 슬롯
  { name: '표범',     phone: '+821000003067' },
  { name: '치타',     phone: '+821000003068' },
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
  console.log('🚀 더미 데이터 삽입 시작 (6/4 익일 테스트 — 고객 68명 × 1슬롯)');
  console.log(`   날짜: ${TARGET_DATE}`);
  console.log(`   초진(과일): ${FRUITS_NEW.length}명, 재진(동물): ${ANIMALS_RET.length}명`);
  console.log(`   슬롯: ${SLOTS.length}개 (${SLOTS[0]}~${SLOTS[SLOTS.length - 1]}, 30분간격), 슬롯당 2초진+2재진`);
  console.log(`   예상 예약: ${FRUITS_NEW.length + ANIMALS_RET.length}건`);

  // 클리닉 조회
  const clinic = await must('클리닉 조회',
    supabase.from('clinics').select('id').eq('slug', 'jongno-foot').single()
  );
  const clinicId = clinic.id;
  console.log(`\n✅ 클리닉 ID: ${clinicId}`);

  // 중복 방지 체크 (전화번호 기준)
  const allPhones = [...FRUITS_NEW, ...ANIMALS_RET].map(c => c.phone);
  const { data: dupCheck } = await supabase
    .from('customers')
    .select('id,name,phone')
    .in('phone', allPhones)
    .eq('is_simulation', true);
  if (dupCheck && dupCheck.length > 0) {
    const existingNames = dupCheck.map(c => `${c.name}(${c.phone})`).join(', ');
    console.warn(`⚠️  테스트 데이터가 이미 존재합니다: ${existingNames}`);
    console.warn('   롤백 후 재실행하세요: node scripts/rollback_testdata_20260604.mjs');
    process.exit(1);
  }

  let totalCustomers = 0;
  let totalResvNew   = 0;
  let totalResvRet   = 0;
  let totalPastCI    = 0;

  // ── 초진 34명 생성 (과일이름) ────────────────────────────
  console.log('\n── 초진 고객 생성 (과일이름 34명) ───────────────────────');
  for (let i = 0; i < FRUITS_NEW.length; i++) {
    const fruit = FRUITS_NEW[i];
    const slot  = SLOTS[Math.floor(i / 2)]; // 2명마다 슬롯 1개

    const cust = await must(`고객(초진) ${fruit.name}`,
      supabase.from('customers').insert({
        clinic_id:      clinicId,
        name:           fruit.name,
        phone:          fruit.phone,
        visit_type:     'new',
        is_simulation:  true,
        inflow_channel: 'meta_ads',
      }).select('id').single()
    );
    totalCustomers++;

    await must(`예약(초진) ${fruit.name} ${slot}`,
      supabase.from('reservations').insert({
        clinic_id:        clinicId,
        customer_id:      cust.id,
        customer_name:    fruit.name,
        customer_phone:   fruit.phone,
        reservation_date: TARGET_DATE,
        reservation_time: slot,
        visit_type:       'new',
        memo:             `더미 | 초진 ${slot} [${SEED_TAG}]`,
        status:           'confirmed',
      })
    );
    totalResvNew++;
    console.log(`  ✔ ${fruit.name} (${fruit.phone}) → ${slot} 예약`);
  }

  // ── 재진 34명 생성 (동물이름) ────────────────────────────
  console.log('\n── 재진 고객 생성 (동물이름 34명) ───────────────────────');
  for (let i = 0; i < ANIMALS_RET.length; i++) {
    const animal   = ANIMALS_RET[i];
    const slot     = SLOTS[Math.floor(i / 2)]; // 2명마다 슬롯 1개
    const queueNum = 9200 + i;

    const cust = await must(`고객(재진) ${animal.name}`,
      supabase.from('customers').insert({
        clinic_id:      clinicId,
        name:           animal.name,
        phone:          animal.phone,
        visit_type:     'returning',
        is_simulation:  true,
        inflow_channel: 'returning',
      }).select('id').single()
    );
    totalCustomers++;

    // 재진 판별용 과거 체크인 1건
    await must(`과거체크인(재진) ${animal.name}`,
      supabase.from('check_ins').insert({
        clinic_id:      clinicId,
        customer_id:    cust.id,
        customer_name:  animal.name,
        customer_phone: animal.phone,
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

    await must(`예약(재진) ${animal.name} ${slot}`,
      supabase.from('reservations').insert({
        clinic_id:        clinicId,
        customer_id:      cust.id,
        customer_name:    animal.name,
        customer_phone:   animal.phone,
        reservation_date: TARGET_DATE,
        reservation_time: slot,
        visit_type:       'returning',
        memo:             `더미 | 재진 ${slot} [${SEED_TAG}]`,
        status:           'confirmed',
      })
    );
    totalResvRet++;
    console.log(`  ✔ ${animal.name} (${animal.phone}) → ${slot} 예약 + 과거체크인`);
  }

  console.log('\n════════════════════════════════════════════════════════');
  console.log(`✅ 더미 데이터 삽입 완료 (6/4 익일 테스트 — 고객 68명 × 1슬롯)`);
  console.log(`   고객:      ${totalCustomers}명 (초진 ${FRUITS_NEW.length}명 + 재진 ${ANIMALS_RET.length}명)`);
  console.log(`   예약:      초진 ${totalResvNew}건 + 재진 ${totalResvRet}건 = ${totalResvNew + totalResvRet}건`);
  console.log(`   과거체크인: ${totalPastCI}건 (${PAST_DATE}, 재진 판별용)`);
  console.log('\n── 슬롯별 분포 ──────────────────────────────────────────');
  SLOTS.forEach((slot, i) => {
    const newNames = FRUITS_NEW.slice(i * 2, i * 2 + 2).map(f => f.name).join('·');
    const retNames = ANIMALS_RET.slice(i * 2, i * 2 + 2).map(a => a.name).join('·');
    console.log(`  ${slot}: 초진[${newNames}] 재진[${retNames}]`);
  });
  console.log('\n── 셀프접수 테스트 번호 ──────────────────────────────────');
  console.log('  초진(과일): 010-0000-3001 ~ 010-0000-3034');
  console.log('  재진(동물): 010-0000-3035 ~ 010-0000-3068');
  console.log('\n── 정리 (테스트 후) ─────────────────────────────────────');
  console.log('   node scripts/rollback_testdata_20260604.mjs');
  console.log('════════════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
