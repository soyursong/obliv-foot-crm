/**
 * T-20260614-foot-DUMMY-RESV-CHARTTEST — APPLY (prod INSERT 24 customers + 24 reservations)
 * 종로점(jongno-foot, clinic 74967aea) 2026-06-14 더미 예약 24건.
 * 12슬롯(10:00~15:30, 30분) × (초진1 new + 재진1 returning) = 24건.
 * 식별 마커: memo='[TEST-DUMMY 20260614]', customers.is_simulation=true, phone prefix +82108814.
 *
 * 6/9 TESTDATA 실패(차트 WSOD) 재발 방지:
 *   - customers + reservations 동시 INSERT, reservations.customer_id 절대 NULL 금지.
 *   - visit_type enum = 'new'/'returning'.
 *   - clinic_id INSERT 전 slug='jongno-foot' resolve 재확인 (불일치 시 abort).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const EXPECT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-06-14';
const MARKER = '[TEST-DUMMY 20260614]';

// ── 0) slug resolve 재확인 (INSERT 전 필수) ──────────────────────────────
const { data: clinics, error: cerr } = await sb.from('clinics').select('id, slug, name').eq('slug', 'jongno-foot');
if (cerr) { console.error('clinic resolve fail:', cerr); process.exit(1); }
const CLINIC_ID = clinics?.[0]?.id;
console.log(`[slug resolve] jongno-foot = ${CLINIC_ID} (${clinics?.[0]?.name})`);
if (CLINIC_ID !== EXPECT_CLINIC_ID) {
  console.error(`ABORT: resolved clinic_id(${CLINIC_ID}) != 티켓 기대값(${EXPECT_CLINIC_ID})`);
  process.exit(1);
}

// ── 1) 슬롯 12개 (10:00~15:30, 30분) ────────────────────────────────────
const SLOTS = ['10:00:00','10:30:00','11:00:00','11:30:00','12:00:00','12:30:00','13:00:00','13:30:00','14:00:00','14:30:00','15:00:00','15:30:00'];
if (SLOTS.length !== 12) { console.error('SLOT count != 12:', SLOTS.length); process.exit(1); }

const phone = (seq) => `+8210${'8814'}${String(seq).padStart(4,'0')}`; // +82108814000X

// 초진(new) 12 + 재진(returning) 12 — 티켓 지정 성명 24개
const NEW12 = ['송재원','원지수','민하린','전승현','탁유진','이하윤','박준혁','노지환','정다솔','손예진','오태준','변서아'];
const RET12 = ['유민지','심재원','홍아영','구하준','나서현','도지은','함채윤','허민준','석지원','기태원','공수아','마지혜'];
const allNames = [...NEW12, ...RET12];
if (NEW12.length !== 12 || RET12.length !== 12) { console.error('이름 개수 오류', NEW12.length, RET12.length); process.exit(1); }
if (new Set(allNames).size !== 24) { console.error('이름 중복!', allNames.length, new Set(allNames).size); process.exit(1); }

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
