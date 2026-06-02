/**
 * 풋센터 CRM 더미 데이터 — 6/2 현장 테스트용
 * 요청자: 김주연 총괄 (slack thread_ts: 1780359755.790479)
 *
 * 구성: 고객 68명 (초진 34명 + 재진 34명) × 1슬롯씩 = 예약 68건
 *   - 초진 34명 (동물이름): 슬롯당 2명 × 17슬롯(11:00~19:00, 30분 간격) = 34건
 *   - 재진 34명 (색깔이름): 슬롯당 2명 × 17슬롯 = 34건
 *   - 재진 34명: 2026-05-01 과거 체크인 1건씩 (재진 판별 충족)
 * 전화번호:
 *   - 초진(동물): +821099080001 ~ +821099080034
 *   - 재진(색깔): +821099080035 ~ +821099080068
 * 마킹: is_simulation=true, memo 태그 [testdata_20260602]
 * 정리: node scripts/rollback_testdata_20260602.mjs
 */

import { createClient } from '@supabase/supabase-js';

const TARGET_DATE = '2026-06-02';
const PAST_DATE   = '2026-05-01';
const SEED_TAG    = 'testdata_20260602';

// 11:00 ~ 19:00 (30분 간격, 17슬롯)
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

// 초진 — 동물이름 34개 (슬롯당 2명)
const ANIMALS_NEW = [
  // 11:00 슬롯
  { name: '사자',         phone: '+821099080001' },
  { name: '호랑이',       phone: '+821099080002' },
  // 11:30 슬롯
  { name: '표범',         phone: '+821099080003' },
  { name: '치타',         phone: '+821099080004' },
  // 12:00 슬롯
  { name: '늑대',         phone: '+821099080005' },
  { name: '여우',         phone: '+821099080006' },
  // 12:30 슬롯
  { name: '토끼',         phone: '+821099080007' },
  { name: '다람쥐',       phone: '+821099080008' },
  // 13:00 슬롯
  { name: '햄스터',       phone: '+821099080009' },
  { name: '고슴도치',     phone: '+821099080010' },
  // 13:30 슬롯
  { name: '공작',         phone: '+821099080011' },
  { name: '두루미',       phone: '+821099080012' },
  // 14:00 슬롯
  { name: '황새',         phone: '+821099080013' },
  { name: '학',           phone: '+821099080014' },
  // 14:30 슬롯
  { name: '까치',         phone: '+821099080015' },
  { name: '까마귀',       phone: '+821099080016' },
  // 15:00 슬롯
  { name: '앵무새',       phone: '+821099080017' },
  { name: '부엉이',       phone: '+821099080018' },
  // 15:30 슬롯
  { name: '독수리',       phone: '+821099080019' },
  { name: '매',           phone: '+821099080020' },
  // 16:00 슬롯
  { name: '펭귄',         phone: '+821099080021' },
  { name: '플라밍고',     phone: '+821099080022' },
  // 16:30 슬롯
  { name: '하마',         phone: '+821099080023' },
  { name: '코뿔소',       phone: '+821099080024' },
  // 17:00 슬롯
  { name: '기린',         phone: '+821099080025' },
  { name: '낙타',         phone: '+821099080026' },
  // 17:30 슬롯
  { name: '코끼리',       phone: '+821099080027' },
  { name: '판다',         phone: '+821099080028' },
  // 18:00 슬롯
  { name: '폴라베어',     phone: '+821099080029' },
  { name: '너구리',       phone: '+821099080030' },
  // 18:30 슬롯
  { name: '수달',         phone: '+821099080031' },
  { name: '코알라',       phone: '+821099080032' },
  // 19:00 슬롯
  { name: '캥거루',       phone: '+821099080033' },
  { name: '나무늘보',     phone: '+821099080034' },
];

// 재진 — 색깔이름 34개 (슬롯당 2명)
const COLORS_RET = [
  // 11:00 슬롯
  { name: '빨강',         phone: '+821099080035' },
  { name: '주황',         phone: '+821099080036' },
  // 11:30 슬롯
  { name: '노랑',         phone: '+821099080037' },
  { name: '초록',         phone: '+821099080038' },
  // 12:00 슬롯
  { name: '파랑',         phone: '+821099080039' },
  { name: '남색',         phone: '+821099080040' },
  // 12:30 슬롯
  { name: '보라',         phone: '+821099080041' },
  { name: '분홍',         phone: '+821099080042' },
  // 13:00 슬롯
  { name: '하늘',         phone: '+821099080043' },
  { name: '민트',         phone: '+821099080044' },
  // 13:30 슬롯
  { name: '갈색',         phone: '+821099080045' },
  { name: '회색',         phone: '+821099080046' },
  // 14:00 슬롯
  { name: '검정',         phone: '+821099080047' },
  { name: '흰색',         phone: '+821099080048' },
  // 14:30 슬롯
  { name: '청록',         phone: '+821099080049' },
  { name: '베이지',       phone: '+821099080050' },
  // 15:00 슬롯
  { name: '살구',         phone: '+821099080051' },
  { name: '라벤더',       phone: '+821099080052' },
  // 15:30 슬롯
  { name: '크림',         phone: '+821099080053' },
  { name: '연보라',       phone: '+821099080054' },
  // 16:00 슬롯
  { name: '진파랑',       phone: '+821099080055' },
  { name: '진초록',       phone: '+821099080056' },
  // 16:30 슬롯
  { name: '카키',         phone: '+821099080057' },
  { name: '금색',         phone: '+821099080058' },
  // 17:00 슬롯
  { name: '은색',         phone: '+821099080059' },
  { name: '청색',         phone: '+821099080060' },
  // 17:30 슬롯
  { name: '홍색',         phone: '+821099080061' },
  { name: '황색',         phone: '+821099080062' },
  // 18:00 슬롯
  { name: '흑색',         phone: '+821099080063' },
  { name: '장밋빛',       phone: '+821099080064' },
  // 18:30 슬롯
  { name: '산호',         phone: '+821099080065' },
  { name: '코랄',         phone: '+821099080066' },
  // 19:00 슬롯
  { name: '마젠타',       phone: '+821099080067' },
  { name: '터콰이즈',     phone: '+821099080068' },
];

const SUPABASE_URL     = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

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
  console.log('🚀 더미 데이터 삽입 시작 (6/2 현장 테스트 — 고객 68명 × 1슬롯)');
  console.log(`   날짜: ${TARGET_DATE}`);
  console.log(`   초진(동물): ${ANIMALS_NEW.length}명, 재진(색깔): ${COLORS_RET.length}명`);
  console.log(`   슬롯: ${SLOTS.length}개 (${SLOTS[0]}~${SLOTS[SLOTS.length - 1]}, 30분 간격), 슬롯당 2초진+2재진`);
  console.log(`   예상 예약: ${ANIMALS_NEW.length + COLORS_RET.length}건`);

  // 클리닉 조회
  const clinic = await must('클리닉 조회',
    supabase.from('clinics').select('id').eq('slug', 'jongno-foot').single()
  );
  const clinicId = clinic.id;
  console.log(`\n✅ 클리닉 ID: ${clinicId}`);

  // 중복 방지 체크 (전화번호 기준)
  const allPhones = [...ANIMALS_NEW, ...COLORS_RET].map(c => c.phone);
  const { data: dupCheck } = await supabase
    .from('customers')
    .select('id,name,phone')
    .in('phone', allPhones)
    .eq('is_simulation', true);
  if (dupCheck && dupCheck.length > 0) {
    const existingNames = dupCheck.map(c => `${c.name}(${c.phone})`).join(', ');
    console.warn(`⚠️  테스트 데이터가 이미 존재합니다: ${existingNames}`);
    console.warn('   롤백 후 재실행하세요: node scripts/rollback_testdata_20260602.mjs');
    process.exit(1);
  }

  let totalCustomers = 0;
  let totalResvNew   = 0;
  let totalResvRet   = 0;
  let totalPastCI    = 0;

  // ── 초진 34명 생성 (동물이름) ────────────────────────────────
  console.log('\n── 초진 고객 생성 (동물이름 34명) ───────────────────────');
  for (let i = 0; i < ANIMALS_NEW.length; i++) {
    const animal = ANIMALS_NEW[i];
    const slot   = SLOTS[Math.floor(i / 2)]; // 2명마다 슬롯 1개

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

  // ── 재진 34명 생성 (색깔이름) ────────────────────────────────
  console.log('\n── 재진 고객 생성 (색깔이름 34명) ───────────────────────');
  for (let i = 0; i < COLORS_RET.length; i++) {
    const color  = COLORS_RET[i];
    const slot   = SLOTS[Math.floor(i / 2)]; // 2명마다 슬롯 1개
    const queueNum = 9500 + i;

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
  console.log(`✅ 더미 데이터 삽입 완료 (6/2 — 고객 68명 × 1슬롯)`);
  console.log(`   고객:       ${totalCustomers}명 (초진 ${ANIMALS_NEW.length}명 + 재진 ${COLORS_RET.length}명)`);
  console.log(`   예약:       초진 ${totalResvNew}건 + 재진 ${totalResvRet}건 = ${totalResvNew + totalResvRet}건`);
  console.log(`   과거체크인: ${totalPastCI}건 (${PAST_DATE}, 재진 판별용)`);
  console.log('\n── 슬롯별 분포 ──────────────────────────────────────────');
  SLOTS.forEach((slot, i) => {
    const newNames = ANIMALS_NEW.slice(i * 2, i * 2 + 2).map(v => v.name).join('·');
    const retNames = COLORS_RET.slice(i * 2, i * 2 + 2).map(c => c.name).join('·');
    console.log(`  ${slot}: 초진[${newNames}] 재진[${retNames}]`);
  });
  console.log('\n── 셀프접수 테스트 번호 ──────────────────────────────────');
  console.log('  초진(동물): 010-9908-0001 ~ 010-9908-0034');
  console.log('  재진(색깔): 010-9908-0035 ~ 010-9908-0068');
  console.log('\n── 정리 (테스트 후) ─────────────────────────────────────');
  console.log('   node scripts/rollback_testdata_20260602.mjs');
  console.log('════════════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
