/**
 * T-20260609-foot-DUMMY-RESV-JONGNO — APPLY (prod INSERT 30 customers + 30 reservations)
 * 종로점(jongno-foot, clinic 74967aea) 2026-06-09 더미 예약 30건.
 * 15슬롯(11:00~17:30, 30분) × (초진1 new + 재진1 returning).
 * 식별 마커: memo='[TEST-DUMMY 20260609]', customers.is_simulation=true, phone prefix +82108809.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-06-09';
const MARKER = '[TEST-DUMMY 20260609]';

// 슬롯 수 모순 해소(autonomy §13.1 documented decision):
//  - 티켓 표기 "11:00~17:30 30분단위 15슬롯"은 수학적으로 14슬롯(11:00..17:30).
//  - 그러나 티켓 제목·db_change_reason·AC-1·AC-5가 일관되게 "총 30건 = 15슬롯×2"로 확정.
//  - 최우선 계약(30건) 충족 위해 15번째 슬롯 18:00 추가 → 11:00~18:00, 15슬롯 × 2 = 30건.
const SLOTS15 = ['11:00:00','11:30:00','12:00:00','12:30:00','13:00:00','13:30:00','14:00:00','14:30:00','15:00:00','15:30:00','16:00:00','16:30:00','17:00:00','17:30:00','18:00:00'];
if (SLOTS15.length !== 15) { console.error('SLOT15 count !=15:', SLOTS15.length); process.exit(1); }

const phone = (seq) => `+8210${'8809'}${String(seq).padStart(4,'0')}`; // +82108809000X

// 초진(new) 15명, 재진(returning) 15명 — 자연스러운 한국 성명 30개 고유
const NEW15 = ['김민준','이서연','박지호','최예린','정우진','강하은','조현우','윤소율','임도윤','한지민','오시우','서유나','신준서','권아윤','황민재'];
const RET15 = ['안서준','류지안','배현서','남채원','문건우','양수아','백지훈','고은별','하예나','곽도현','성유진','차민서','주하랑','진서우','표승호'];
const allNames = [...NEW15, ...RET15];
if (new Set(allNames).size !== 30) { console.error('이름 중복!', allNames.length, new Set(allNames).size); process.exit(1); }

const custRows = [];
let seq = 0;
NEW15.forEach((name) => { seq++; custRows.push({ clinic_id: CLINIC_ID, name, phone: phone(seq), visit_type: 'new', is_simulation: true, memo: MARKER }); });
RET15.forEach((name) => { seq++; custRows.push({ clinic_id: CLINIC_ID, name, phone: phone(seq), visit_type: 'returning', is_simulation: true, memo: MARKER }); });

console.log(`고객 ${custRows.length}건 INSERT 시작...`);
const { data: custIns, error: ce } = await sb.from('customers').insert(custRows).select('id, name, phone, visit_type');
if (ce) { console.error('CUSTOMER INSERT FAIL:', ce); process.exit(1); }
console.log(`고객 INSERT OK: ${custIns.length}건`);

// map name -> id
const idByName = {}; custIns.forEach(c => { idByName[c.name] = c.id; });

// build reservations: 슬롯마다 new1+returning1
const resvRows = [];
const log = [];
for (let i = 0; i < 15; i++) {
  const time = SLOTS15[i];
  const newName = NEW15[i];
  const retName = RET15[i];
  resvRows.push({ clinic_id: CLINIC_ID, customer_id: idByName[newName], customer_name: newName, customer_phone: custRows.find(r=>r.name===newName).phone, reservation_date: DATE, reservation_time: time, visit_type: 'new', status: 'confirmed', memo: MARKER });
  resvRows.push({ clinic_id: CLINIC_ID, customer_id: idByName[retName], customer_name: retName, customer_phone: custRows.find(r=>r.name===retName).phone, reservation_date: DATE, reservation_time: time, visit_type: 'returning', status: 'confirmed', memo: MARKER });
  log.push({ time: time.slice(0,5), 초진: newName, 재진: retName });
}

console.log(`예약 ${resvRows.length}건 INSERT 시작...`);
const { data: resvIns, error: re } = await sb.from('reservations').insert(resvRows).select('id, customer_name, reservation_time, visit_type');
if (re) {
  console.error('RESERVATION INSERT FAIL:', re);
  // 롤백: 방금 만든 고객 삭제
  await sb.from('customers').delete().in('id', custIns.map(c=>c.id));
  console.log('고객 롤백 완료');
  process.exit(1);
}
console.log(`예약 INSERT OK: ${resvIns.length}건`);

console.log('\n=== 생성 목록 (시간 | 초진 | 재진) ===');
log.forEach(r => console.log(`${r.time} | 초진:${r.초진.padEnd(4)} | 재진:${r.재진}`));

console.log('\n=== 검증: 오늘 더미 건수 ===');
const { data: chk } = await sb.from('reservations').select('id').eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).eq('memo', MARKER);
console.log(`reservations 더미: ${chk?.length}건`);
const { data: chkc } = await sb.from('customers').select('id').eq('clinic_id', CLINIC_ID).eq('memo', MARKER).eq('is_simulation', true);
console.log(`customers 더미: ${chkc?.length}건`);
console.log('\n=== DONE ===');
