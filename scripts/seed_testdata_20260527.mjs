/**
 * 풋센터 CRM 더미 데이터 — 5/27 현장 테스트용 (재생성 v2)
 * T-20260527-foot-RESV-TESTDATA-REGEN (P1)
 *
 * 구성: 8슬롯(11:00~18:00) × (초진 4건 + 재진 4건) = 64건 예약
 *   - 슬롯마다 서로 다른 동물 이름 배정 (AC-3)
 *   - 각 고객은 자신의 슬롯에만 예약 1건 보유
 *   - 총 고객: 64명 (슬롯별 고유)
 *   - 전화 패턴: +82100HH00N00 (HH=슬롯시간, N=슬롯내 순번)
 * 마킹: is_simulation=true
 * 정리: node scripts/rollback_testdata_20260527.mjs
 */

import { createClient } from '@supabase/supabase-js';

const TARGET_DATE = '2026-05-27';
const PAST_DATE   = '2026-05-01';

/**
 * 슬롯별 고유 동물 배정
 * new[0..3] = 초진 4마리 / ret[0..3] = 재진 4마리
 */
const SLOT_ANIMALS = [
  {
    slot: '11:00',
    new: ['강아지', '고양이', '토끼',   '판다'],
    ret: ['사자',   '호랑이', '코끼리', '기린'],
  },
  {
    slot: '12:00',
    new: ['햄스터', '앵무새', '거북이',   '고슴도치'],
    ret: ['여우',   '늑대',   '곰',       '원숭이'],
  },
  {
    slot: '13:00',
    new: ['다람쥐', '공작새', '독수리',   '학'],
    ret: ['펭귄',   '북극곰', '캥거루',   '코알라'],
  },
  {
    slot: '14:00',
    new: ['오리',   '참새',   '까치',     '비둘기'],
    ret: ['치타',   '표범',   '하이에나', '재규어'],
  },
  {
    slot: '15:00',
    new: ['돌고래', '고래',   '상어',     '바다사자'],
    ret: ['악어',   '이구아나', '도마뱀', '카멜레온'],
  },
  {
    slot: '16:00',
    new: ['낙타',   '얼룩말', '하마',     '코뿔소'],
    ret: ['두루미', '황새',   '왜가리',   '해오라기'],
  },
  {
    slot: '17:00',
    new: ['수달',   '밍크',   '오소리',   '족제비'],
    ret: ['사슴',   '노루',   '고라니',   '염소'],
  },
  {
    slot: '18:00',
    new: ['문어',   '오징어', '낙지',     '꽃게'],
    ret: ['개구리', '두꺼비', '도롱뇽',   '뱀'],
  },
];

/**
 * E.164 전화번호 생성
 * slotHour: 11~18, animalIdx: 1~8 (1~4=초진, 5~8=재진)
 * 패턴: +8210-0HH0-0N00
 * 예) 11시 1번 → +821001100100
 */
function makePhoneE164(slotHour, animalIdx) {
  const part1 = String(slotHour).padStart(2,'0');  // 11~18
  const part2 = String(animalIdx).padStart(2,'0'); // 01~08
  return `+821000${part1}0${part2}0`;
}

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
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
  console.log('🚀 더미 데이터 삽입 시작 (5/27 현장 테스트 v2 — 슬롯별 고유 동물)');
  console.log(`   날짜: ${TARGET_DATE}`);
  console.log(`   슬롯: ${SLOT_ANIMALS.length}개 (11:00~18:00, 1시간 간격)`);
  console.log(`   예상: ${SLOT_ANIMALS.length}슬롯 × (초진4 + 재진4) = ${SLOT_ANIMALS.length * 8}건`);

  console.log('\n── 슬롯별 동물 배정 ────────────────────────────────────');
  for (const s of SLOT_ANIMALS) {
    console.log(`  ${s.slot}: 초진=[${s.new.join(', ')}] / 재진=[${s.ret.join(', ')}]`);
  }

  const clinic = await must('클리닉 조회',
    supabase.from('clinics').select('id').eq('slug', 'jongno-foot').single()
  );
  const clinicId = clinic.id;
  console.log(`\n✅ 클리닉 ID: ${clinicId}`);

  const allAnimalNames = SLOT_ANIMALS.flatMap(s => [...s.new, ...s.ret]);
  const { data: dupCheck } = await supabase
    .from('customers')
    .select('id,name')
    .in('name', allAnimalNames)
    .eq('is_simulation', true);
  if (dupCheck && dupCheck.length > 0) {
    const existingNames = dupCheck.map(c => c.name).join(', ');
    console.warn(`⚠️  테스트 동물 데이터가 이미 존재합니다: ${existingNames}`);
    console.warn('   롤백 후 재실행하세요: node scripts/rollback_testdata_20260527.mjs');
    process.exit(1);
  }

  let totalCustomers = 0;
  let totalNew = 0;
  let totalRet = 0;
  let totalPastCheckIn = 0;

  for (let si = 0; si < SLOT_ANIMALS.length; si++) {
    const { slot, new: newAnimals, ret: retAnimals } = SLOT_ANIMALS[si];
    const slotHour = parseInt(slot.split(':')[0], 10); // 11~18
    console.log(`\n════ 슬롯 ${slot} ════════════════════════════════`);

    for (let ai = 0; ai < newAnimals.length; ai++) {
      const name = newAnimals[ai];
      const phone = makePhoneE164(slotHour, ai + 1); // 1~4

      const cust = await must(`고객(초진) ${name}`,
        supabase.from('customers').insert({
          clinic_id:      clinicId,
          name,
          phone,
          visit_type:     'new',
          is_simulation:  true,
          inflow_channel: 'meta_ads',
        }).select('id').single()
      );
      totalCustomers++;

      await must(`예약(초진) ${name} ${slot}`,
        supabase.from('reservations').insert({
          clinic_id:        clinicId,
          customer_id:      cust.id,
          customer_name:    name,
          customer_phone:   phone,
          reservation_date: TARGET_DATE,
          reservation_time: slot,
          visit_type:       'new',
          memo:             `더미 | 초진 ${slot}`,
          status:           'confirmed',
        })
      );
      totalNew++;
      console.log(`  ✔ 초진 ${name} (${phone})`);
    }

    for (let ai = 0; ai < retAnimals.length; ai++) {
      const name = retAnimals[ai];
      const phone = makePhoneE164(slotHour, ai + 5); // 5~8

      const cust = await must(`고객(재진) ${name}`,
        supabase.from('customers').insert({
          clinic_id:      clinicId,
          name,
          phone,
          visit_type:     'returning',
          is_simulation:  true,
          inflow_channel: 'returning',
        }).select('id').single()
      );
      totalCustomers++;

      const queueNum = 9000 + (si * 4) + (ai + 1); // 9001~9032
      await must(`과거체크인(재진) ${name}`,
        supabase.from('check_ins').insert({
          clinic_id:      clinicId,
          customer_id:    cust.id,
          customer_name:  name,
          customer_phone: phone,
          visit_type:     'returning',
          status:         'done',
          queue_number:   queueNum,
          checked_in_at:  `${PAST_DATE}T10:00:00+09:00`,
          completed_at:   `${PAST_DATE}T11:30:00+09:00`,
          sort_order:     queueNum,
          notes:          JSON.stringify({ seed: 'testdata_20260527_v2', past_checkin: true }),
        })
      );
      totalPastCheckIn++;

      await must(`예약(재진) ${name} ${slot}`,
        supabase.from('reservations').insert({
          clinic_id:        clinicId,
          customer_id:      cust.id,
          customer_name:    name,
          customer_phone:   phone,
          reservation_date: TARGET_DATE,
          reservation_time: slot,
          visit_type:       'returning',
          memo:             `더미 | 재진 ${slot}`,
          status:           'confirmed',
        })
      );
      totalRet++;
      console.log(`  ✔ 재진 ${name} (${phone})`);
    }
  }

  console.log('\n════════════════════════════════════════════════════════');
  console.log(`✅ 더미 데이터 삽입 완료 (5/27 v2 — 슬롯별 고유 동물)`);
  console.log(`   고객: ${totalCustomers}명 (초진 ${totalNew}명 + 재진 ${totalRet}명)`);
  console.log(`   예약: 초진 ${totalNew}건 + 재진 ${totalRet}건 = ${totalNew + totalRet}건`);
  console.log(`   과거체크인(재진 판별): ${totalPastCheckIn}건 (${PAST_DATE})`);
  console.log('\n── 슬롯별 배정 요약 ─────────────────────────────────────');
  for (const s of SLOT_ANIMALS) {
    console.log(`  ${s.slot}: 초진[${s.new.join('·')}] / 재진[${s.ret.join('·')}]`);
  }
  console.log('\n── 정리 (테스트 후) ─────────────────────────────────────');
  console.log('   node scripts/rollback_testdata_20260527.mjs');
  console.log('════════════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
