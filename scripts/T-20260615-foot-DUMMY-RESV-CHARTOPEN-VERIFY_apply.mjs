/**
 * T-20260615-foot-DUMMY-RESV-CHARTOPEN-VERIFY — APPLY (prod INSERT 32 customers + 32 reservations)
 * 종로점(jongno-foot, clinic 74967aea) 2026-06-15 더미 예약 32건.
 * 16슬롯(11:00~18:30, 30분) × (초진1 new + 재진1 returning) = 32건.
 *
 * 식별/롤백 키 (티켓 의무):
 *   - created_by = 'TEST-20260615'  (reservations + customers 공통)
 *   - reservations: created_by='TEST-20260615' AND reservation_date='2026-06-15'
 *   - customers   : created_by='TEST-20260615' AND phone LIKE '+82108615%'
 *   - 보조 마커 memo='[TEST-DUMMY 20260615]'
 *
 * ⚠ is_simulation=FALSE (의도): admin 예약현황 캘린더는 stripSimulationRows로
 *   is_simulation=true 고객행을 숨김(T-20260610 ADMIN-SIM-FILTER, '토마토'만 화이트리스트).
 *   본 티켓은 현장(김주연 총괄)이 캘린더 카드 클릭→차트 열림을 직접 검증하는 테스트이므로
 *   더미가 캘린더에 보여야 한다 → is_simulation=false. 격리는 created_by/phone prefix + 당일 롤백.
 *
 * GO_WARN(prod 쓰기): INSERT only. 기존 운영 데이터 UPDATE/DELETE 절대 금지.
 *   - clinic_id 추측 금지 → slug='jongno-foot' resolve 재확인, EXPECT 불일치 시 abort.
 *   - customer_id NULL 행 하나라도 있으면 abort + 고객 롤백.
 *   - 재실행 가드: 이미 created_by='TEST-20260615'/6-15 데이터 존재 시 abort.
 *   - phone: 티켓의 '010-9999-XXXX' 의도(충돌없는 더미)는 유지하되, 운영 phone이 전부
 *     E.164(+8210...)이고 +82109999 대역은 기존 40건 충돌 → 날짜 인코딩 prefix +82108615 채택
 *     (선행 read-only 조회로 0건 확인). 6/14 컨벤션(+82108814) 계승.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const EXPECT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-06-15';
const MARKER = '[TEST-DUMMY 20260615]';
const CREATED_BY = 'TEST-20260615';
const PHONE_PREFIX = '+82108615'; // +82108615 0001 .. 0032

// ── 0) slug resolve 재확인 (INSERT 전 필수, 추측 금지) ───────────────────
const { data: clinics, error: cerr } = await sb.from('clinics').select('id, slug, name').eq('slug', 'jongno-foot');
if (cerr) { console.error('clinic resolve fail:', cerr); process.exit(1); }
const CLINIC_ID = clinics?.[0]?.id;
console.log(`[slug resolve] jongno-foot = ${CLINIC_ID} (${clinics?.[0]?.name})`);
if (CLINIC_ID !== EXPECT_CLINIC_ID) {
  console.error(`ABORT: resolved clinic_id(${CLINIC_ID}) != 티켓 기대값(${EXPECT_CLINIC_ID})`);
  process.exit(1);
}

// ── 0.5) 재실행 가드 (idempotency) ──────────────────────────────────────
const { data: dup } = await sb.from('reservations').select('id').eq('clinic_id', CLINIC_ID).eq('created_by', CREATED_BY).eq('reservation_date', DATE);
if (dup && dup.length) {
  console.error(`ABORT: 이미 created_by='${CREATED_BY}' / ${DATE} reservations ${dup.length}건 존재. cleanup 후 재실행.`);
  process.exit(1);
}

// ── 1) 슬롯 16개 (11:00~18:30, 30분) ────────────────────────────────────
const SLOTS = ['11:00:00','11:30:00','12:00:00','12:30:00','13:00:00','13:30:00','14:00:00','14:30:00','15:00:00','15:30:00','16:00:00','16:30:00','17:00:00','17:30:00','18:00:00','18:30:00'];
if (SLOTS.length !== 16) { console.error('SLOT count != 16:', SLOTS.length); process.exit(1); }

const phone = (seq) => `${PHONE_PREFIX}${String(seq).padStart(4,'0')}`;

// 초진(new) 16 + 재진(returning) 16 — 자연스러운 한국인 성명 32개 (prefix無)
const NEW16 = ['강서연','윤도현','배수빈','임지후','신예나','조민재','백서윤','류시우','곽다은','성준영','하은지','남도윤','추소민','양지호','표하람','진우빈'];
const RET16 = ['고나윤','문태경','서지안','우성민','안소율','한도현','황민서','장하람','권유나','노건우','도예린','맹준서','빈서후','석현우','천보경','피지원'];
const allNames = [...NEW16, ...RET16];
if (NEW16.length !== 16 || RET16.length !== 16) { console.error('이름 개수 오류', NEW16.length, RET16.length); process.exit(1); }
if (new Set(allNames).size !== 32) { console.error('이름 중복!', allNames.length, new Set(allNames).size); process.exit(1); }

const custRows = [];
let seq = 0;
NEW16.forEach((name) => { seq++; custRows.push({ clinic_id: CLINIC_ID, name, phone: phone(seq), visit_type: 'new', is_simulation: false, created_by: CREATED_BY, memo: MARKER }); });
RET16.forEach((name) => { seq++; custRows.push({ clinic_id: CLINIC_ID, name, phone: phone(seq), visit_type: 'returning', is_simulation: false, created_by: CREATED_BY, memo: MARKER }); });

console.log(`고객 ${custRows.length}건 INSERT 시작...`);
const { data: custIns, error: ce } = await sb.from('customers').insert(custRows).select('id, name, phone, visit_type, chart_number');
if (ce) { console.error('CUSTOMER INSERT FAIL:', ce); process.exit(1); }
console.log(`고객 INSERT OK: ${custIns.length}건`);

const idByName = {}; custIns.forEach(c => { idByName[c.name] = c.id; });
const phoneByName = {}; custRows.forEach(r => { phoneByName[r.name] = r.phone; });

// ── 2) reservations: 슬롯마다 new1+returning1, customer_id 직결 (NULL 금지) ─
const resvRows = [];
const log = [];
for (let i = 0; i < 16; i++) {
  const time = SLOTS[i];
  const newName = NEW16[i];
  const retName = RET16[i];
  resvRows.push({ clinic_id: CLINIC_ID, customer_id: idByName[newName], customer_name: newName, customer_phone: phoneByName[newName], reservation_date: DATE, reservation_time: time, visit_type: 'new', status: 'confirmed', created_by: CREATED_BY, memo: MARKER });
  resvRows.push({ clinic_id: CLINIC_ID, customer_id: idByName[retName], customer_name: retName, customer_phone: phoneByName[retName], reservation_date: DATE, reservation_time: time, visit_type: 'returning', status: 'confirmed', created_by: CREATED_BY, memo: MARKER });
  log.push({ time: time.slice(0,5), 초진: newName, 재진: retName });
}

// 안전장치: customer_id NULL 행이 하나라도 있으면 abort + 고객 롤백
const nullCid = resvRows.filter(r => !r.customer_id);
if (nullCid.length) {
  console.error('ABORT: customer_id NULL 행 발견', nullCid.length);
  await sb.from('customers').delete().in('id', custIns.map(c=>c.id));
  console.log('고객 롤백 완료');
  process.exit(1);
}

console.log(`예약 ${resvRows.length}건 INSERT 시작...`);
const { data: resvIns, error: re } = await sb.from('reservations').insert(resvRows).select('id, customer_name, customer_id, reservation_time, visit_type');
if (re) {
  console.error('RESERVATION INSERT FAIL:', re);
  await sb.from('customers').delete().in('id', custIns.map(c=>c.id));
  console.log('고객 롤백 완료');
  process.exit(1);
}
console.log(`예약 INSERT OK: ${resvIns.length}건 (customer_id NULL: ${resvIns.filter(r=>!r.customer_id).length})`);

console.log('\n=== 생성 목록 (시간 | 초진 | 재진) ===');
log.forEach(r => console.log(`${r.time} | 초진:${r.초진.padEnd(4)} | 재진:${r.재진}`));

// ── 3) 검증: row count ──────────────────────────────────────────────────
console.log('\n=== 검증: 오늘 더미 건수 ===');
const { data: chk } = await sb.from('reservations').select('id, visit_type').eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).eq('created_by', CREATED_BY);
const newCnt = (chk||[]).filter(r=>r.visit_type==='new').length;
const retCnt = (chk||[]).filter(r=>r.visit_type==='returning').length;
console.log(`reservations 더미: ${chk?.length}건 (new=${newCnt}, returning=${retCnt})`);
const { data: chkc } = await sb.from('customers').select('id').eq('clinic_id', CLINIC_ID).eq('created_by', CREATED_BY).like('phone', '+82108615%');
console.log(`customers 더미: ${chkc?.length}건`);

if (chk?.length === 32 && chkc?.length === 32 && newCnt === 16 && retCnt === 16) {
  console.log('\n=== DONE: 32 reservations + 32 customers OK ===');
} else {
  console.error('\n=== WARN: 기대 count(32/32, 16new/16ret) 불일치 ===');
}
