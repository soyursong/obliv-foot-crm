/**
 * T-20260610-foot-DUMMY-RESV-CHARTVERIFY — APPLY (prod INSERT 24 customers + 24 reservations)
 * 종로점(jongno-foot, clinic 74967aea) 2026-06-10 더미 예약 24건.
 * 12슬롯(12:00~17:30, 30분) × (초진1 new + 재진1 returning) = 24건.
 * 식별 마커: memo='[TEST-DUMMY 20260610]', customers.is_simulation=true, phone prefix +82108810.
 *
 * 6/9 TESTDATA 실패(차트 WSOD) 재발 방지:
 *   - customers + reservations 동시 INSERT, reservations.customer_id 절대 NULL 금지 (JONGNO 표준 패턴).
 *   - visit_type enum = 'new'/'returning' (CHECK IN('new','returning','experience')).
 *   - clinic_id INSERT 전 slug='jongno-foot' resolve 재확인 (불일치 시 abort).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const EXPECT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-06-10';
const MARKER = '[TEST-DUMMY 20260610]';

// ── 0) slug resolve 재확인 (INSERT 전 필수) ──────────────────────────────
const { data: clinics, error: cerr } = await sb.from('clinics').select('id, slug, name').eq('slug', 'jongno-foot');
if (cerr) { console.error('clinic resolve fail:', cerr); process.exit(1); }
const CLINIC_ID = clinics?.[0]?.id;
console.log(`[slug resolve] jongno-foot = ${CLINIC_ID} (${clinics?.[0]?.name})`);
if (CLINIC_ID !== EXPECT_CLINIC_ID) {
  console.error(`ABORT: resolved clinic_id(${CLINIC_ID}) != 티켓 기대값(${EXPECT_CLINIC_ID})`);
  process.exit(1);
}

// ── 1) 슬롯 12개 (12:00~17:30, 30분) ────────────────────────────────────
const SLOTS = ['12:00:00','12:30:00','13:00:00','13:30:00','14:00:00','14:30:00','15:00:00','15:30:00','16:00:00','16:30:00','17:00:00','17:30:00'];
if (SLOTS.length !== 12) { console.error('SLOT count != 12:', SLOTS.length); process.exit(1); }

const phone = (seq) => `+8210${'8810'}${String(seq).padStart(4,'0')}`; // +82108810000X

// 초진(new) 12 + 재진(returning) 12 — 자연 한국 성명 24개 고유 (6/9 JONGNO 30명과 중복 회피)
const NEW12 = ['김도현','이준영','박서윤','최지우','정민서','강태현','조유빈','윤하준','임수빈','한예준','오지율','서동현'];
const RET12 = ['신아람','권민수','황지헌','안유리','류재민','배소율','남기훈','문채영','양승우','백하늘','고지원','차도윤'];
const allNames = [...NEW12, ...RET12];
if (new Set(allNames).size !== 24) { console.error('이름 중복!', allNames.length, new Set(allNames).size); process.exit(1); }

// 6/9 JONGNO 30명과 충돌 검사 (clinic 내 동명이인 → 차트 homonym 거부 분기 예방)
const JONGNO0609 = ['김민준','이서연','박지호','최예린','정우진','강하은','조현우','윤소율','임도윤','한지민','오시우','서유나','신준서','권아윤','황민재','안서준','류지안','배현서','남채원','문건우','양수아','백지훈','고은별','하예나','곽도현','성유진','차민서','주하랑','진서우','표승호'];
const collide = allNames.filter(n => JONGNO0609.includes(n));
if (collide.length) { console.error('6/9 JONGNO 이름과 충돌:', collide); process.exit(1); }

const custRows = [];
let seq = 0;
NEW12.forEach((name) => { seq++; custRows.push({ clinic_id: CLINIC_ID, name, phone: phone(seq), visit_type: 'new', is_simulation: true, memo: MARKER }); });
RET12.forEach((name) => { seq++; custRows.push({ clinic_id: CLINIC_ID, name, phone: phone(seq), visit_type: 'returning', is_simulation: true, memo: MARKER }); });

console.log(`고객 ${custRows.length}건 INSERT 시작...`);
const { data: custIns, error: ce } = await sb.from('customers').insert(custRows).select('id, name, phone, visit_type, chart_number');
if (ce) { console.error('CUSTOMER INSERT FAIL:', ce); process.exit(1); }
console.log(`고객 INSERT OK: ${custIns.length}건`);

const idByName = {}; custIns.forEach(c => { idByName[c.name] = c.id; });
const phoneByName = {}; custRows.forEach(r => { phoneByName[r.name] = r.phone; });

// reservations: 슬롯마다 new1+returning1, customer_id 직결 (NULL 금지)
const resvRows = [];
const log = [];
for (let i = 0; i < 12; i++) {
  const time = SLOTS[i];
  const newName = NEW12[i];
  const retName = RET12[i];
  resvRows.push({ clinic_id: CLINIC_ID, customer_id: idByName[newName], customer_name: newName, customer_phone: phoneByName[newName], reservation_date: DATE, reservation_time: time, visit_type: 'new', status: 'confirmed', memo: MARKER });
  resvRows.push({ clinic_id: CLINIC_ID, customer_id: idByName[retName], customer_name: retName, customer_phone: phoneByName[retName], reservation_date: DATE, reservation_time: time, visit_type: 'returning', status: 'confirmed', memo: MARKER });
  log.push({ time: time.slice(0,5), 초진: newName, 재진: retName });
}

// 안전장치: customer_id NULL 행이 하나라도 있으면 abort + 고객 롤백
const nullCid = resvRows.filter(r => !r.customer_id);
if (nullCid.length) {
  console.error('ABORT: customer_id NULL 행 발견', nullCid.length);
  await sb.from('customers').delete().in('id', custIns.map(c=>c.id));
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

console.log('\n=== 검증: 오늘 더미 건수 ===');
const { data: chk } = await sb.from('reservations').select('id').eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).eq('memo', MARKER);
console.log(`reservations 더미: ${chk?.length}건`);
const { data: chkc } = await sb.from('customers').select('id').eq('clinic_id', CLINIC_ID).eq('memo', MARKER).eq('is_simulation', true);
console.log(`customers 더미: ${chkc?.length}건`);
console.log('\n=== DONE ===');
