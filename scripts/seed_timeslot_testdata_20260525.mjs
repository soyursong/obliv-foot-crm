/**
 * 풋센터 CRM 더미 데이터 — 5/25 시간대별 초진/재진 테스트용
 * T-20260524-foot-TIMESLOT-TESTDATA (P2)
 *
 * 구성: 오전 초진4+재진4 + 오후 초진4+재진4 = 총 16명
 *   - 오전 슬롯: 09:00, 10:00, 11:00, 12:00 (1h 단위, 슬롯당 초진1+재진1)
 *   - 오후 슬롯: 13:00, 14:00, 15:00, 16:00 (1h 단위, 슬롯당 초진1+재진1)
 *   - 이름: "[테스트] 초진AM09" / "[테스트] 재진AM09" 형식 (AC-3)
 *   - 전화: 010-9999-5001 ~ 010-9999-5016 (E.164: +821099995001~16)
 * 마킹: created_by='test-seed-20260525', is_simulation=true (AC-4)
 * 정리: node scripts/rollback_timeslot_testdata_20260525.mjs
 */

import { createClient } from '@supabase/supabase-js';

// ============================================================
// === 확정 파라미터 ===
// ============================================================
const TARGET_DATE = '2026-05-25';
const PAST_DATE   = '2026-05-01'; // 재진 판별용 과거 체크인 날짜
const SEED_TAG    = 'test-seed-20260525'; // AC-4: created_by 마킹 (정리용)
const NAME_PREFIX = '[테스트]';            // AC-3: 식별용 접두어

/** AC-1: 오전(09~12) 1h 단위 */
const MORNING_SLOTS   = ['09:00', '10:00', '11:00', '12:00'];
/** AC-2: 오후(13~17) 1h 단위 */
const AFTERNOON_SLOTS = ['13:00', '14:00', '15:00', '16:00'];
const ALL_SLOTS = [...MORNING_SLOTS, ...AFTERNOON_SLOTS]; // 8슬롯 × 2(초+재) = 16명

/**
 * 전화번호: 010-9999-5001 ~ 010-9999-5016 (E.164 형식)
 * 기존 사용 범위와 충돌 없는 구간:
 *   +821099990001~0020: 5/17 개원일 테스트
 *   +821000000201~0296: 5/22 현장 테스트
 *   +821099995001~5016: ← 이번 신규 구간
 */
function makePhone(seq) {
  // seq: 1~16 → 010-9999-5001 ~ 010-9999-5016
  return '+82109999' + String(5000 + seq);
}

/** E.164 → 표시용 010-XXXX-XXXX */
function displayPhone(seq) {
  const tail = String(5000 + seq);
  return `010-9999-${tail}`;
}

/** 슬롯 시간 → 구분 레이블 (09:00 → AM09, 13:00 → PM13) */
function slotLabel(timeStr) {
  const hour = parseInt(timeStr.split(':')[0], 10);
  const period = hour < 13 ? 'AM' : 'PM';
  return `${period}${String(hour).padStart(2, '0')}`;
}

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── 유틸 ───────────────────────────────────────────────────
async function must(label, promise) {
  const { data, error } = await promise;
  if (error) {
    console.error(`❌ ${label}:`, error.message, JSON.stringify(error));
    throw new Error(`${label}: ${error.message}`);
  }
  return data;
}

// ─── 메인 ───────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log('T-20260524-foot-TIMESLOT-TESTDATA');
  console.log('5/25 시간대별 초진/재진 더미 데이터 삽입');
  console.log('='.repeat(60));
  console.log(`날짜: ${TARGET_DATE}`);
  console.log(`오전 슬롯: ${MORNING_SLOTS.join(', ')}`);
  console.log(`오후 슬롯: ${AFTERNOON_SLOTS.join(', ')}`);
  console.log(`예상: 초진 ${ALL_SLOTS.length}명 + 재진 ${ALL_SLOTS.length}명 = ${ALL_SLOTS.length * 2}명`);
  console.log(`태그: created_by='${SEED_TAG}'`);

  // ── STEP 1: 클리닉 조회 ──
  console.log('\n[STEP 1] 클리닉 조회...');
  const clinic = await must('클리닉 조회',
    supabase.from('clinics').select('id, name').eq('slug', 'jongno-foot').single()
  );
  const clinicId = clinic.id;
  console.log(`  ✅ 클리닉: ${clinic.name} (${clinicId})`);

  // ── STEP 2: 중복 방지 ──
  console.log('\n[STEP 2] 중복 체크 (created_by 기준)...');
  const { data: dupCheck } = await supabase
    .from('customers')
    .select('id')
    .eq('created_by', SEED_TAG)
    .eq('clinic_id', clinicId)
    .limit(1);
  if (dupCheck && dupCheck.length > 0) {
    console.warn(`  ⚠️  '${SEED_TAG}' 태그 데이터가 이미 존재합니다.`);
    console.warn('  롤백 후 재실행: node scripts/rollback_timeslot_testdata_20260525.mjs');
    process.exit(1);
  }
  console.log('  ✅ 중복 없음 — 삽입 가능');

  // ── STEP 3: 데이터 삽입 ──
  console.log('\n[STEP 3] 슬롯별 데이터 삽입...');

  let totalNew = 0;
  let totalRet = 0;
  let seq = 0; // 전화번호 순번 (1~16)

  for (const slotTime of ALL_SLOTS) {
    const label = slotLabel(slotTime);
    const isPM  = slotTime >= '13:00';
    const period = isPM ? '오후' : '오전';
    const [slotHourStr, slotMinStr] = slotTime.split(':');
    const slotHour = parseInt(slotHourStr, 10);
    const slotMin  = parseInt(slotMinStr,  10);

    console.log(`\n  ⏰ [${period}] ${slotTime}`);

    // ── 초진 ──────────────────────────────────────────────
    seq++;
    {
      const name  = `${NAME_PREFIX} 초진${label}`;
      const phone = makePhone(seq);

      const cust = await must(`고객(초진) ${name}`,
        supabase.from('customers').insert({
          clinic_id:      clinicId,
          name,
          phone,
          visit_type:     'new',
          is_simulation:  true,
          inflow_channel: 'meta_ads',
          memo:           `[테스트] 5/25 시간대별 — 초진 ${slotTime}`,
          created_by:     SEED_TAG,
        }).select('id').single()
      );

      await must(`예약(초진) ${name}`,
        supabase.from('reservations').insert({
          clinic_id:        clinicId,
          customer_id:      cust.id,
          customer_name:    name,
          customer_phone:   phone,
          reservation_date: TARGET_DATE,
          reservation_time: slotTime,
          visit_type:       'new',
          status:           'confirmed',
          memo:             `[테스트] 5/25 초진 ${slotTime}`,
          created_by:       SEED_TAG,
        })
      );

      totalNew++;
      console.log(`    ✔ 초진 ${name}  ${displayPhone(seq)}`);
    }

    // ── 재진 ──────────────────────────────────────────────
    seq++;
    {
      const name  = `${NAME_PREFIX} 재진${label}`;
      const phone = makePhone(seq);

      const cust = await must(`고객(재진) ${name}`,
        supabase.from('customers').insert({
          clinic_id:      clinicId,
          name,
          phone,
          visit_type:     'returning',
          is_simulation:  true,
          inflow_channel: 'returning',
          memo:           `[테스트] 5/25 시간대별 — 재진 ${slotTime}`,
          created_by:     SEED_TAG,
        }).select('id').single()
      );

      await must(`예약(재진) ${name}`,
        supabase.from('reservations').insert({
          clinic_id:        clinicId,
          customer_id:      cust.id,
          customer_name:    name,
          customer_phone:   phone,
          reservation_date: TARGET_DATE,
          reservation_time: slotTime,
          visit_type:       'returning',
          status:           'confirmed',
          memo:             `[테스트] 5/25 재진 ${slotTime}`,
          created_by:       SEED_TAG,
        })
      );

      // 과거 체크인 1건 (재진 판별 근거)
      const endTotalMin = slotHour * 60 + slotMin + 30;
      const endH = Math.floor(endTotalMin / 60);
      const endM = endTotalMin % 60;
      await must(`과거체크인(재진) ${name}`,
        supabase.from('check_ins').insert({
          clinic_id:      clinicId,
          customer_id:    cust.id,
          customer_name:  name,
          customer_phone: phone,
          visit_type:     'returning',
          status:         'done',
          queue_number:   seq + 500,
          checked_in_at:  `${PAST_DATE}T${String(slotHour).padStart(2,'0')}:${String(slotMin).padStart(2,'0')}:00+09:00`,
          completed_at:   `${PAST_DATE}T${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}:00+09:00`,
          sort_order:     seq + 500,
          notes:          JSON.stringify({ seed: SEED_TAG, past_checkin: true }),
        })
      );

      totalRet++;
      console.log(`    ✔ 재진 ${name}  ${displayPhone(seq)}  (과거체크인: ${PAST_DATE})`);
    }
  }

  // ── STEP 4: AC 검증 ──
  console.log('\n[STEP 4] AC 검증...');

  // AC-1: 오전 예약 건수
  const { count: amCount } = await supabase
    .from('reservations')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', SEED_TAG)
    .eq('clinic_id', clinicId)
    .eq('reservation_date', TARGET_DATE)
    .in('reservation_time', MORNING_SLOTS.map(s => s + ':00'));
  console.log(`  AC-1 오전(09~12): ${amCount}건 ${amCount === MORNING_SLOTS.length * 2 ? '✅' : '❌'} (초진${MORNING_SLOTS.length}+재진${MORNING_SLOTS.length})`);

  // AC-2: 오후 예약 건수
  const { count: pmCount } = await supabase
    .from('reservations')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', SEED_TAG)
    .eq('clinic_id', clinicId)
    .eq('reservation_date', TARGET_DATE)
    .in('reservation_time', AFTERNOON_SLOTS.map(s => s + ':00'));
  console.log(`  AC-2 오후(13~17): ${pmCount}건 ${pmCount === AFTERNOON_SLOTS.length * 2 ? '✅' : '❌'} (초진${AFTERNOON_SLOTS.length}+재진${AFTERNOON_SLOTS.length})`);

  // AC-3: [테스트] 접두어
  const { count: prefixCount } = await supabase
    .from('customers')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', SEED_TAG)
    .like('name', `${NAME_PREFIX}%`);
  console.log(`  AC-3 [테스트] 접두어: ${prefixCount}건 ${prefixCount === ALL_SLOTS.length * 2 ? '✅' : '❌'}`);

  // AC-4: created_by 마킹
  const { count: tagCount } = await supabase
    .from('customers')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', SEED_TAG);
  console.log(`  AC-4 created_by='${SEED_TAG}': ${tagCount}건 ${tagCount === ALL_SLOTS.length * 2 ? '✅' : '❌'}`);

  // 샘플 6건 출력
  const { data: samples } = await supabase
    .from('reservations')
    .select('customer_name, customer_phone, reservation_time, visit_type, status')
    .eq('created_by', SEED_TAG)
    .eq('reservation_date', TARGET_DATE)
    .order('reservation_time')
    .limit(6);
  console.log('\n  샘플 6건:');
  samples?.forEach(s =>
    console.log(`    ${s.customer_name}  ${s.customer_phone}  ${s.reservation_time}  ${s.visit_type}  ${s.status}`)
  );

  console.log('\n' + '='.repeat(60));
  console.log('✅ 5/25 시간대별 테스트 데이터 삽입 완료');
  console.log(`   초진: ${totalNew}명 | 재진: ${totalRet}명 | 합계: ${totalNew + totalRet}명`);
  console.log(`   오전: ${MORNING_SLOTS.join(' / ')}`);
  console.log(`   오후: ${AFTERNOON_SLOTS.join(' / ')}`);
  console.log('\n── 셀프접수 테스트 방법 ──────────────────────────────────');
  console.log('   URL: https://obliv-foot-crm.vercel.app/checkin/jongno-foot');
  console.log('   초진 전화번호 (오전): 010-9999-5001 / 010-9999-5003 / 010-9999-5005 / 010-9999-5007');
  console.log('   재진 전화번호 (오전): 010-9999-5002 / 010-9999-5004 / 010-9999-5006 / 010-9999-5008');
  console.log('   초진 전화번호 (오후): 010-9999-5009 / 010-9999-5011 / 010-9999-5013 / 010-9999-5015');
  console.log('   재진 전화번호 (오후): 010-9999-5010 / 010-9999-5012 / 010-9999-5014 / 010-9999-5016');
  console.log('\n── 정리 (테스트 후) ─────────────────────────────────────');
  console.log('   node scripts/rollback_timeslot_testdata_20260525.mjs');
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
