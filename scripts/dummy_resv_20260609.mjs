/**
 * ⛔ DEPRECATED — 재실행 금지 (T-20260608-foot-DUMMY-CHART-OPEN-FIX, 2026-06-09)
 *   결함: 이 생성기는 reservations 만 INSERT 하고 customer_id 를 NULL 로 둔다 (customers 미동반).
 *         → 카드 클릭 시 Dashboard.openChartFor 가 customer_id 직결 경로(Branch 1)를 못 타고,
 *           이름-fallback(동명이인 의료안전 가드)으로 빠져 "차트 안 열림"이 발생한다.
 *         이것이 6/3·6/8·6/9 "격번 차트 안 열림" 3차 재발의 단일 근본원인(데이터 결함, 코드 무결).
 *   정정: 더미는 반드시 customers 동반 생성 + reservations.customer_id SET 패턴으로 만든다.
 *         → 올바른 표준 생성기: scripts/T-20260609-foot-DUMMY-RESV-JONGNO_apply.mjs (참조).
 *   회수: 이미 INSERT 된 결함 행은 scripts/rollback_dummy_resv_20260609.sql 또는
 *         scripts/T-20260608-foot-DUMMY-CHART-OPEN-FIX_remediate.mjs 로 제거됨.
 *   ※ 본 파일은 안티패턴 기록용으로만 보존. 아래 로직을 그대로 재실행하지 말 것.
 *
 * T-20260609-foot-DUMMY-RESV-TESTDATA (원 헤더)
 * 종로 풋센터(jongno-foot) 테스트용 더미 예약 30건 INSERT
 *
 * 구성: 2026-06-09, 11:00~18:00 30분 단위 15슬롯 × (초진 new 1 + 재진 returning 1) = 30행
 * 식별 마커: created_by='test-dummy-20260609', memo prefix '[테스트더미]'
 * 가드: clinic_id는 slug='jongno-foot' resolve 단일행만. 0/2+행이면 중단.
 * 롤백: DELETE FROM reservations WHERE created_by='test-dummy-20260609';
 */
import { createClient } from '@supabase/supabase-js';

throw new Error('[DEPRECATED] dummy_resv_20260609.mjs 는 customer_id 미연결 결함 생성기입니다. ' +
  'T-20260609-foot-DUMMY-RESV-JONGNO_apply.mjs(customers 동반 + customer_id SET)를 사용하세요. ' +
  '재실행하려면 이 가드를 의도적으로 제거해야 합니다.');

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY =
  '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const MARKER = 'test-dummy-20260609';
const DATE = '2026-06-09';
const SLOTS = [
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00',
]; // 15 slots

const NEW_NAMES = [
  '김민준', '이서연', '박지호', '최수아', '정우진', '강하은', '조현우', '윤서윤',
  '임도윤', '한지유', '오시우', '서예린', '신준서', '권나윤', '황민서',
]; // 15 → 초진 new
const RET_NAMES = [
  '안채원', '송지훈', '류하준', '전소율', '홍지안', '문가은', '배승현', '백은우',
  '유다인', '남시현', '노유나', '하준영', '곽지원', '성예준', '차서아',
]; // 15 → 재진 returning

async function main() {
  // 1) clinic_id resolve (slug='jongno-foot') — 단일행 가드
  const { data: clinics, error: cErr } = await supabase
    .from('clinics')
    .select('id, slug, name')
    .eq('slug', 'jongno-foot');
  if (cErr) throw new Error('clinic resolve 실패: ' + cErr.message);
  if (!clinics || clinics.length !== 1) {
    throw new Error(
      `GUARD FAIL: slug='jongno-foot' resolve = ${clinics ? clinics.length : 0}행 (단일행 아님 → 중단)`
    );
  }
  const clinicId = clinics[0].id;
  console.log(`[resolve] jongno-foot clinic_id = ${clinicId} (name=${clinics[0].name})`);

  // 2) 30행 구성
  const rows = [];
  for (let i = 0; i < SLOTS.length; i++) {
    const t = SLOTS[i];
    rows.push({
      clinic_id: clinicId,
      customer_name: NEW_NAMES[i],
      reservation_date: DATE,
      reservation_time: t,
      visit_type: 'new',
      status: 'confirmed',
      created_by: MARKER,
      memo: '[테스트더미] 6/9 테스트',
    });
    rows.push({
      clinic_id: clinicId,
      customer_name: RET_NAMES[i],
      reservation_date: DATE,
      reservation_time: t,
      visit_type: 'returning',
      status: 'confirmed',
      created_by: MARKER,
      memo: '[테스트더미] 6/9 테스트',
    });
  }
  console.log(`[build] ${rows.length}행 구성 (new ${NEW_NAMES.length} + returning ${RET_NAMES.length})`);

  // 3) INSERT
  const { data: inserted, error: iErr } = await supabase
    .from('reservations')
    .insert(rows)
    .select('id');
  if (iErr) throw new Error('INSERT 실패: ' + iErr.message);
  console.log(`[insert] ${inserted.length}행 INSERT 완료`);

  // 4) 검증 — count(*)=30 & count(distinct clinic_id)=1
  const { data: verify, error: vErr } = await supabase
    .from('reservations')
    .select('clinic_id, visit_type')
    .eq('created_by', MARKER);
  if (vErr) throw new Error('검증 SELECT 실패: ' + vErr.message);
  const total = verify.length;
  const distinctClinics = new Set(verify.map((r) => r.clinic_id)).size;
  const newCnt = verify.filter((r) => r.visit_type === 'new').length;
  const retCnt = verify.filter((r) => r.visit_type === 'returning').length;
  console.log(
    `[verify] count=${total} distinct_clinic=${distinctClinics} (single=${clinicId}) | new=${newCnt} returning=${retCnt}`
  );

  const pass = total === 30 && distinctClinics === 1 && newCnt === 15 && retCnt === 15;
  console.log(pass ? '[RESULT] PASS ✅' : '[RESULT] FAIL ❌');
  console.log(
    `[rollback] DELETE FROM reservations WHERE clinic_id='${clinicId}' AND created_by='${MARKER}';`
  );
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error('[ERROR]', e.message);
  process.exit(1);
});
