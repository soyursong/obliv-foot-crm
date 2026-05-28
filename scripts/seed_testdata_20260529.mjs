/**
 * 풋센터 CRM 더미 데이터 — 5/29 현장 테스트용
 * T-20260529-foot-DUMMY-RESV-80
 *
 * 구성: 고객 80명 (초진 40명 + 재진 40명) × 1슬롯씩 = 예약 80건
 *   - 초진 40명 (동물이름): 슬롯당 4명 × 10슬롯(10~19시) = 40건
 *   - 재진 40명 (과일이름): 슬롯당 4명 × 10슬롯(10~19시) = 40건
 *   - 재진 40명: 2026-05-01 과거 체크인 1건씩 (재진 판별 충족)
 * 전화번호:
 *   - 초진(동물): +821000002901 ~ +821000002940
 *   - 재진(과일): +821000002941 ~ +821000002980
 * 마킹: is_simulation=true, notes.seed='testdata_20260529'
 * 정리: node scripts/rollback_testdata_20260529.mjs
 */

import { createClient } from '@supabase/supabase-js';

const TARGET_DATE = '2026-05-29';
const PAST_DATE   = '2026-05-01';
const SEED_TAG    = 'testdata_20260529';

// 10:00 ~ 19:00 (10개 시간대)
const SLOTS = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'];

// 초진 — 동물이름 40개 (슬롯당 4마리: indices 0-3, 4-7, ..., 36-39)
const ANIMALS_NEW = [
  // 10:00 슬롯
  { name: '고양이',   phone: '+821000002901' },
  { name: '강아지',   phone: '+821000002902' },
  { name: '토끼',     phone: '+821000002903' },
  { name: '사자',     phone: '+821000002904' },
  // 11:00 슬롯
  { name: '호랑이',   phone: '+821000002905' },
  { name: '코끼리',   phone: '+821000002906' },
  { name: '기린',     phone: '+821000002907' },
  { name: '펭귄',     phone: '+821000002908' },
  // 12:00 슬롯
  { name: '올빼미',   phone: '+821000002909' },
  { name: '독수리',   phone: '+821000002910' },
  { name: '돌고래',   phone: '+821000002911' },
  { name: '하마',     phone: '+821000002912' },
  // 13:00 슬롯
  { name: '악어',     phone: '+821000002913' },
  { name: '판다',     phone: '+821000002914' },
  { name: '여우',     phone: '+821000002915' },
  { name: '늑대',     phone: '+821000002916' },
  // 14:00 슬롯
  { name: '수달',     phone: '+821000002917' },
  { name: '두루미',   phone: '+821000002918' },
  { name: '참새',     phone: '+821000002919' },
  { name: '까치',     phone: '+821000002920' },
  // 15:00 슬롯
  { name: '부엉이',   phone: '+821000002921' },
  { name: '매',       phone: '+821000002922' },
  { name: '오리',     phone: '+821000002923' },
  { name: '거위',     phone: '+821000002924' },
  // 16:00 슬롯
  { name: '백조',     phone: '+821000002925' },
  { name: '원숭이',   phone: '+821000002926' },
  { name: '다람쥐',   phone: '+821000002927' },
  { name: '고슴도치', phone: '+821000002928' },
  // 17:00 슬롯
  { name: '낙타',     phone: '+821000002929' },
  { name: '물개',     phone: '+821000002930' },
  { name: '해달',     phone: '+821000002931' },
  { name: '북극곰',   phone: '+821000002932' },
  // 18:00 슬롯
  { name: '표범',     phone: '+821000002933' },
  { name: '치타',     phone: '+821000002934' },
  { name: '코뿔소',   phone: '+821000002935' },
  { name: '하이에나', phone: '+821000002936' },
  // 19:00 슬롯
  { name: '플라밍고', phone: '+821000002937' },
  { name: '공작',     phone: '+821000002938' },
  { name: '앵무새',   phone: '+821000002939' },
  { name: '카멜레온', phone: '+821000002940' },
];

// 재진 — 과일이름 40개 (슬롯당 4개: indices 0-3, 4-7, ..., 36-39)
const FRUITS_RET = [
  // 10:00 슬롯
  { name: '사과',       phone: '+821000002941' },
  { name: '딸기',       phone: '+821000002942' },
  { name: '포도',       phone: '+821000002943' },
  { name: '바나나',     phone: '+821000002944' },
  // 11:00 슬롯
  { name: '수박',       phone: '+821000002945' },
  { name: '키위',       phone: '+821000002946' },
  { name: '망고',       phone: '+821000002947' },
  { name: '복숭아',     phone: '+821000002948' },
  // 12:00 슬롯
  { name: '자두',       phone: '+821000002949' },
  { name: '블루베리',   phone: '+821000002950' },
  { name: '체리',       phone: '+821000002951' },
  { name: '레몬',       phone: '+821000002952' },
  // 13:00 슬롯
  { name: '오렌지',     phone: '+821000002953' },
  { name: '라임',       phone: '+821000002954' },
  { name: '파인애플',   phone: '+821000002955' },
  { name: '코코넛',     phone: '+821000002956' },
  // 14:00 슬롯
  { name: '석류',       phone: '+821000002957' },
  { name: '감',         phone: '+821000002958' },
  { name: '배',         phone: '+821000002959' },
  { name: '귤',         phone: '+821000002960' },
  // 15:00 슬롯
  { name: '매실',       phone: '+821000002961' },
  { name: '살구',       phone: '+821000002962' },
  { name: '참외',       phone: '+821000002963' },
  { name: '멜론',       phone: '+821000002964' },
  // 16:00 슬롯
  { name: '용과',       phone: '+821000002965' },
  { name: '구아바',     phone: '+821000002966' },
  { name: '리치',       phone: '+821000002967' },
  { name: '무화과',     phone: '+821000002968' },
  // 17:00 슬롯
  { name: '패션프루트', phone: '+821000002969' },
  { name: '아보카도',   phone: '+821000002970' },
  { name: '두리안',     phone: '+821000002971' },
  { name: '파파야',     phone: '+821000002972' },
  // 18:00 슬롯
  { name: '유자',       phone: '+821000002973' },
  { name: '산딸기',     phone: '+821000002974' },
  { name: '크랜베리',   phone: '+821000002975' },
  { name: '대추',       phone: '+821000002976' },
  // 19:00 슬롯
  { name: '밤',         phone: '+821000002977' },
  { name: '호두',       phone: '+821000002978' },
  { name: '자몽',       phone: '+821000002979' },
  { name: '한라봉',     phone: '+821000002980' },
];

const SUPABASE_URL     = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

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
  console.log('🚀 더미 데이터 삽입 시작 (5/29 현장 테스트 — 고객 80명 × 1슬롯)');
  console.log(`   날짜: ${TARGET_DATE}`);
  console.log(`   초진(동물): ${ANIMALS_NEW.length}명, 재진(과일): ${FRUITS_RET.length}명`);
  console.log(`   슬롯: ${SLOTS.length}개 (${SLOTS[0]}~${SLOTS[SLOTS.length - 1]}), 슬롯당 4초진+4재진`);
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
    console.warn('   롤백 후 재실행하세요: node scripts/rollback_testdata_20260529.mjs');
    process.exit(1);
  }

  let totalCustomers = 0;
  let totalResvNew   = 0;
  let totalResvRet   = 0;
  let totalPastCI    = 0;

  // ── 초진 40명 생성 (동물이름) ────────────────────────────
  console.log('\n── 초진 고객 생성 (동물이름 40명) ───────────────────────');
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

  // ── 재진 40명 생성 (과일이름) ────────────────────────────
  console.log('\n── 재진 고객 생성 (과일이름 40명) ───────────────────────');
  for (let i = 0; i < FRUITS_RET.length; i++) {
    const fruit = FRUITS_RET[i];
    const slot  = SLOTS[Math.floor(i / 4)]; // 4명마다 슬롯 1개
    const queueNum = 9100 + i;

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
  console.log(`✅ 더미 데이터 삽입 완료 (5/29 — 고객 80명 × 1슬롯)`);
  console.log(`   고객:      ${totalCustomers}명 (초진 ${ANIMALS_NEW.length}명 + 재진 ${FRUITS_RET.length}명)`);
  console.log(`   예약:      초진 ${totalResvNew}건 + 재진 ${totalResvRet}건 = ${totalResvNew + totalResvRet}건`);
  console.log(`   과거체크인: ${totalPastCI}건 (${PAST_DATE}, 재진 판별용)`);
  console.log('\n── 슬롯별 분포 ──────────────────────────────────────────');
  SLOTS.forEach((slot, i) => {
    const newNames = ANIMALS_NEW.slice(i * 4, i * 4 + 4).map(a => a.name).join('·');
    const retNames = FRUITS_RET.slice(i * 4, i * 4 + 4).map(f => f.name).join('·');
    console.log(`  ${slot}: 초진[${newNames}] 재진[${retNames}]`);
  });
  console.log('\n── 셀프접수 테스트 번호 ──────────────────────────────────');
  console.log('  초진(동물): 010-0000-2901 ~ 010-0000-2940');
  console.log('  재진(과일): 010-0000-2941 ~ 010-0000-2980');
  console.log('\n── 정리 (테스트 후) ─────────────────────────────────────');
  console.log('   node scripts/rollback_testdata_20260529.mjs');
  console.log('════════════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
