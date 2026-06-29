/**
 * 풋센터 CRM 더미 데이터 — 5/30 현장 테스트용 (V5)
 * T-20260530-foot-DUMMY-DATA-0530
 *
 * 구성: 고객 128명 (초진 64명 + 재진 64명) × 1슬롯씩 = 예약 128건
 *   - 초진 64명 (동물이름): 슬롯당 4명 × 16슬롯(10:00~17:30, 30분 간격) = 64건
 *   - 재진 64명 (과일/식물이름): 슬롯당 4명 × 16슬롯 = 64건
 *   - 재진 64명: 2026-05-01 과거 체크인 1건씩 (재진 판별 충족)
 * 전화번호:
 *   - 초진(동물): +821099060001 ~ +821099060064
 *   - 재진(과일): +821099060065 ~ +821099060128
 * 마킹: is_simulation=true, memo 태그 [testdata_20260530]
 * 정리: node scripts/rollback_testdata_20260530.mjs
 */

import { createClient } from '@supabase/supabase-js';

const TARGET_DATE = '2026-05-30';
const PAST_DATE   = '2026-05-01';
const SEED_TAG    = 'testdata_20260530';

// 10:00 ~ 17:30 (30분 간격, 16슬롯)
const SLOTS = [
  '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30',
];

// 초진 — 동물이름 64개 (슬롯당 4마리: indices i/4)
const ANIMALS_NEW = [
  // 10:00 슬롯
  { name: '얼룩말',      phone: '+821099060001' },
  { name: '알파카',      phone: '+821099060002' },
  { name: '라마',        phone: '+821099060003' },
  { name: '고릴라',      phone: '+821099060004' },
  // 10:30 슬롯
  { name: '침팬지',      phone: '+821099060005' },
  { name: '오랑우탄',    phone: '+821099060006' },
  { name: '이구아나',    phone: '+821099060007' },
  { name: '도마뱀',      phone: '+821099060008' },
  // 11:00 슬롯
  { name: '뱀',          phone: '+821099060009' },
  { name: '개구리',      phone: '+821099060010' },
  { name: '두꺼비',      phone: '+821099060011' },
  { name: '거북이',      phone: '+821099060012' },
  // 11:30 슬롯
  { name: '문어',        phone: '+821099060013' },
  { name: '오징어',      phone: '+821099060014' },
  { name: '새우',        phone: '+821099060015' },
  { name: '게',          phone: '+821099060016' },
  // 12:00 슬롯
  { name: '가재',        phone: '+821099060017' },
  { name: '해파리',      phone: '+821099060018' },
  { name: '불가사리',    phone: '+821099060019' },
  { name: '달팽이',      phone: '+821099060020' },
  // 12:30 슬롯
  { name: '잠자리',      phone: '+821099060021' },
  { name: '나비',        phone: '+821099060022' },
  { name: '벌',          phone: '+821099060023' },
  { name: '개미',        phone: '+821099060024' },
  // 13:00 슬롯
  { name: '무당벌레',    phone: '+821099060025' },
  { name: '사슴',        phone: '+821099060026' },
  { name: '노루',        phone: '+821099060027' },
  { name: '멧돼지',      phone: '+821099060028' },
  // 13:30 슬롯
  { name: '오소리',      phone: '+821099060029' },
  { name: '족제비',      phone: '+821099060030' },
  { name: '담비',        phone: '+821099060031' },
  { name: '청설모',      phone: '+821099060032' },
  // 14:00 슬롯
  { name: '두더지',      phone: '+821099060033' },
  { name: '박쥐',        phone: '+821099060034' },
  { name: '고래',        phone: '+821099060035' },
  { name: '바다코끼리',  phone: '+821099060036' },
  // 14:30 슬롯
  { name: '물범',        phone: '+821099060037' },
  { name: '해마',        phone: '+821099060038' },
  { name: '넙치',        phone: '+821099060039' },
  { name: '참치',        phone: '+821099060040' },
  // 15:00 슬롯
  { name: '연어',        phone: '+821099060041' },
  { name: '송어',        phone: '+821099060042' },
  { name: '잉어',        phone: '+821099060043' },
  { name: '붕어',        phone: '+821099060044' },
  // 15:30 슬롯
  { name: '복어',        phone: '+821099060045' },
  { name: '갈치',        phone: '+821099060046' },
  { name: '꽁치',        phone: '+821099060047' },
  { name: '정어리',      phone: '+821099060048' },
  // 16:00 슬롯
  { name: '고등어',      phone: '+821099060049' },
  { name: '삼치',        phone: '+821099060050' },
  { name: '방어',        phone: '+821099060051' },
  { name: '전어',        phone: '+821099060052' },
  // 16:30 슬롯
  { name: '가자미',      phone: '+821099060053' },
  { name: '준치',        phone: '+821099060054' },
  { name: '조기',        phone: '+821099060055' },
  { name: '대구',        phone: '+821099060056' },
  // 17:00 슬롯
  { name: '멸치',        phone: '+821099060057' },
  { name: '청어',        phone: '+821099060058' },
  { name: '빙어',        phone: '+821099060059' },
  { name: '은어',        phone: '+821099060060' },
  // 17:30 슬롯
  { name: '쏘가리',      phone: '+821099060061' },
  { name: '메기',        phone: '+821099060062' },
  { name: '가물치',      phone: '+821099060063' },
  { name: '미꾸라지',    phone: '+821099060064' },
];

// 재진 — 과일/식물열매 이름 64개 (슬롯당 4개: indices i/4)
const FRUITS_RET = [
  // 10:00 슬롯
  { name: '올리브',      phone: '+821099060065' },
  { name: '비파',        phone: '+821099060066' },
  { name: '망고스틴',    phone: '+821099060067' },
  { name: '람부탄',      phone: '+821099060068' },
  // 10:30 슬롯
  { name: '롱안',        phone: '+821099060069' },
  { name: '금귤',        phone: '+821099060070' },
  { name: '포멜로',      phone: '+821099060071' },
  { name: '탄제린',      phone: '+821099060072' },
  // 11:00 슬롯
  { name: '아세롤라',    phone: '+821099060073' },
  { name: '피타야',      phone: '+821099060074' },
  { name: '잭프루트',    phone: '+821099060075' },
  { name: '미라클베리',  phone: '+821099060076' },
  // 11:30 슬롯
  { name: '피칸',        phone: '+821099060077' },
  { name: '아몬드',      phone: '+821099060078' },
  { name: '헤이즐넛',    phone: '+821099060079' },
  { name: '캐슈넛',      phone: '+821099060080' },
  // 12:00 슬롯
  { name: '피스타치오',  phone: '+821099060081' },
  { name: '마카다미아',  phone: '+821099060082' },
  { name: '잣',          phone: '+821099060083' },
  { name: '은행',        phone: '+821099060084' },
  // 12:30 슬롯
  { name: '도토리',      phone: '+821099060085' },
  { name: '구기자',      phone: '+821099060086' },
  { name: '오미자',      phone: '+821099060087' },
  { name: '다래',        phone: '+821099060088' },
  // 13:00 슬롯
  { name: '머루',        phone: '+821099060089' },
  { name: '개복숭아',    phone: '+821099060090' },
  { name: '모과',        phone: '+821099060091' },
  { name: '탱자',        phone: '+821099060092' },
  // 13:30 슬롯
  { name: '복분자',      phone: '+821099060093' },
  { name: '블랙베리',    phone: '+821099060094' },
  { name: '라즈베리',    phone: '+821099060095' },
  { name: '구스베리',    phone: '+821099060096' },
  // 14:00 슬롯
  { name: '커런트',      phone: '+821099060097' },
  { name: '보이젠베리',  phone: '+821099060098' },
  { name: '로건베리',    phone: '+821099060099' },
  { name: '엘더베리',    phone: '+821099060100' },
  // 14:30 슬롯
  { name: '로즈힙',      phone: '+821099060101' },
  { name: '호손베리',    phone: '+821099060102' },
  { name: '아사이베리',  phone: '+821099060103' },
  { name: '고지베리',    phone: '+821099060104' },
  // 15:00 슬롯
  { name: '꾸지뽕',      phone: '+821099060105' },
  { name: '뽕나무열매',  phone: '+821099060106' },
  { name: '서양자두',    phone: '+821099060107' },
  { name: '베르가못',    phone: '+821099060108' },
  // 15:30 슬롯
  { name: '퀸스',        phone: '+821099060109' },
  { name: '타마린드',    phone: '+821099060110' },
  { name: '카람볼라',    phone: '+821099060111' },
  { name: '야자열매',    phone: '+821099060112' },
  // 16:00 슬롯
  { name: '카카오',      phone: '+821099060113' },
  { name: '바닐라',      phone: '+821099060114' },
  { name: '커피열매',    phone: '+821099060115' },
  { name: '후추',        phone: '+821099060116' },
  // 16:30 슬롯
  { name: '카피르라임',  phone: '+821099060117' },
  { name: '카사바',      phone: '+821099060118' },
  { name: '타로',        phone: '+821099060119' },
  { name: '사탕수수',    phone: '+821099060120' },
  // 17:00 슬롯
  { name: '토마토',      phone: '+821099060121' },
  { name: '파프리카',    phone: '+821099060122' },
  { name: '가지',        phone: '+821099060123' },
  { name: '오크라',      phone: '+821099060124' },
  // 17:30 슬롯
  { name: '아티초크',    phone: '+821099060125' },
  { name: '브로콜리',    phone: '+821099060126' },
  { name: '케일',        phone: '+821099060127' },
  { name: '고구마',      phone: '+821099060128' },
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
  console.log('🚀 더미 데이터 삽입 시작 (5/30 현장 테스트 V5 — 고객 128명 × 1슬롯)');
  console.log(`   날짜: ${TARGET_DATE}`);
  console.log(`   초진(동물): ${ANIMALS_NEW.length}명, 재진(과일): ${FRUITS_RET.length}명`);
  console.log(`   슬롯: ${SLOTS.length}개 (${SLOTS[0]}~${SLOTS[SLOTS.length - 1]}, 30분 간격), 슬롯당 4초진+4재진`);
  console.log(`   예상 예약: ${ANIMALS_NEW.length + FRUITS_RET.length}건`);

  // 클리닉 조회
  const clinic = await must('클리닉 조회',
    supabase.from('clinics').select('id').eq('slug', 'jongno-foot').single()
  );
  const clinicId = clinic.id;
  console.log(`\n✅ 클리닉 ID: ${clinicId}`);

  // 중복 방지 체크 (전화번호 기준)
  const allPhones = [...ANIMALS_NEW, ...FRUITS_RET].map(c => c.phone);
  const { data: dupCheck } = await supabase
    .from('customers')
    .select('id,name,phone')
    .in('phone', allPhones)
    .eq('is_simulation', true);
  if (dupCheck && dupCheck.length > 0) {
    const existingNames = dupCheck.map(c => `${c.name}(${c.phone})`).join(', ');
    console.warn(`⚠️  테스트 데이터가 이미 존재합니다: ${existingNames}`);
    console.warn('   롤백 후 재실행하세요: node scripts/rollback_testdata_20260530.mjs');
    process.exit(1);
  }

  let totalCustomers = 0;
  let totalResvNew   = 0;
  let totalResvRet   = 0;
  let totalPastCI    = 0;

  // ── 초진 64명 생성 (동물이름) ────────────────────────────────
  console.log('\n── 초진 고객 생성 (동물이름 64명) ───────────────────────');
  for (let i = 0; i < ANIMALS_NEW.length; i++) {
    const animal = ANIMALS_NEW[i];
    const slot   = SLOTS[Math.floor(i / 4)]; // 4명마다 슬롯 1개

    const cust = await must(`고객(초진) ${animal.name}`,
      supabase.from('customers').insert({
        clinic_id:      clinicId,
        name:           animal.name,
        phone:          animal.phone,
        visit_type:     'new',
        is_simulation:  true,
        inflow_channel: 'meta_ads',
      }).select('id').single()
    );
    totalCustomers++;

    await must(`예약(초진) ${animal.name} ${slot}`,
      supabase.from('reservations').insert({
        clinic_id:        clinicId,
        customer_id:      cust.id,
        customer_name:    animal.name,
        customer_phone:   animal.phone,
        reservation_date: TARGET_DATE,
        reservation_time: slot,
        visit_type:       'new',
        memo:             `더미 | 초진 ${slot} [${SEED_TAG}]`,
        status:           'confirmed',
      })
    );
    totalResvNew++;
    console.log(`  ✔ ${animal.name} (${animal.phone}) → ${slot} 예약`);
  }

  // ── 재진 64명 생성 (과일/식물이름) ──────────────────────────
  console.log('\n── 재진 고객 생성 (과일이름 64명) ───────────────────────');
  for (let i = 0; i < FRUITS_RET.length; i++) {
    const fruit  = FRUITS_RET[i];
    const slot   = SLOTS[Math.floor(i / 4)]; // 4명마다 슬롯 1개
    const queueNum = 9200 + i;

    const cust = await must(`고객(재진) ${fruit.name}`,
      supabase.from('customers').insert({
        clinic_id:      clinicId,
        name:           fruit.name,
        phone:          fruit.phone,
        visit_type:     'returning',
        is_simulation:  true,
        inflow_channel: 'returning',
      }).select('id').single()
    );
    totalCustomers++;

    // 재진 판별용 과거 체크인 1건
    await must(`과거체크인(재진) ${fruit.name}`,
      supabase.from('check_ins').insert({
        clinic_id:      clinicId,
        customer_id:    cust.id,
        customer_name:  fruit.name,
        customer_phone: fruit.phone,
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

    await must(`예약(재진) ${fruit.name} ${slot}`,
      supabase.from('reservations').insert({
        clinic_id:        clinicId,
        customer_id:      cust.id,
        customer_name:    fruit.name,
        customer_phone:   fruit.phone,
        reservation_date: TARGET_DATE,
        reservation_time: slot,
        visit_type:       'returning',
        memo:             `더미 | 재진 ${slot} [${SEED_TAG}]`,
        status:           'confirmed',
      })
    );
    totalResvRet++;
    console.log(`  ✔ ${fruit.name} (${fruit.phone}) → ${slot} 예약 + 과거체크인`);
  }

  console.log('\n════════════════════════════════════════════════════════');
  console.log(`✅ 더미 데이터 삽입 완료 (5/30 V5 — 고객 128명 × 1슬롯)`);
  console.log(`   고객:       ${totalCustomers}명 (초진 ${ANIMALS_NEW.length}명 + 재진 ${FRUITS_RET.length}명)`);
  console.log(`   예약:       초진 ${totalResvNew}건 + 재진 ${totalResvRet}건 = ${totalResvNew + totalResvRet}건`);
  console.log(`   과거체크인: ${totalPastCI}건 (${PAST_DATE}, 재진 판별용)`);
  console.log('\n── 슬롯별 분포 ──────────────────────────────────────────');
  SLOTS.forEach((slot, i) => {
    const newNames = ANIMALS_NEW.slice(i * 4, i * 4 + 4).map(a => a.name).join('·');
    const retNames = FRUITS_RET.slice(i * 4, i * 4 + 4).map(f => f.name).join('·');
    console.log(`  ${slot}: 초진[${newNames}] 재진[${retNames}]`);
  });
  console.log('\n── 셀프접수 테스트 번호 ──────────────────────────────────');
  console.log('  초진(동물): 010-9906-0001 ~ 010-9906-0064');
  console.log('  재진(과일): 010-9906-0065 ~ 010-9906-0128');
  console.log('\n── 정리 (테스트 후) ─────────────────────────────────────');
  console.log('   node scripts/rollback_testdata_20260530.mjs');
  console.log('════════════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
