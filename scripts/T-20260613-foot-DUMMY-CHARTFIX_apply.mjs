/**
 * T-20260613-foot-DUMMY-CHARTFIX — APPLY (cleanup 결함더미 52 + 표준 26 재생성)
 * 종로점(jongno-foot, clinic 74967aea) 2026-06-13.
 *
 * 진단(_diag) 결과:
 *   - 6/13 예약 56건 = 결함더미 52(이중 생성: memo "테스트 더미" 26 + "[테스트더미]" 26) + 실데이터 4(보존).
 *   - 결함더미 52건 전량 customer_id NULL → 차트 미오픈(6/9 TESTDATA 재발).
 *   - 장쳰 2회 응답으로 정확히 2배 생성.
 *
 * 조치:
 *   1) cleanup: 6/13 + memo IN('테스트 더미','[테스트더미]') 예약만 DELETE (정확히 52, 아니면 abort).
 *      ⚠ "테스트 더미"는 6/08에도 76건 존재 → 반드시 reservation_date='2026-06-13' 범위 한정.
 *      ⚠ 실데이터 4건(memo null, cid SET)은 마커 불일치로 자동 보존.
 *      52건 모두 cid NULL → 연결 customers 없음(삭제할 customers 없음).
 *   2) 표준 재생성: 13슬롯(10:00~16:00,30분) × (초진 new 1 + 재진 returning 1) = 26건.
 *      customers + reservations 동시 INSERT, customer_id 직결(NULL 금지),
 *      is_simulation=false(ADMIN-SIM-FILTER 9e065ae 회피, 6/12 선례),
 *      memo='[TEST-DUMMY 20260613]', phone +82108813XXXX, 고유 한국 성명(기존·6/08더미 무충돌).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const EXPECT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-06-13';
const MARKER = '[TEST-DUMMY 20260613]';
const PHONE_PREFIX = '8813';
const OLD_MARKERS = ['테스트 더미', '[테스트더미]'];

// ── 0) slug resolve 재확인 ──────────────────────────────────────────────
const { data: clinics, error: cerr } = await sb.from('clinics').select('id, slug, name').eq('slug', 'jongno-foot');
if (cerr) { console.error('clinic resolve fail:', cerr); process.exit(1); }
const CLINIC_ID = clinics?.[0]?.id;
console.log(`[slug resolve] jongno-foot = ${CLINIC_ID} (${clinics?.[0]?.name})`);
if (CLINIC_ID !== EXPECT_CLINIC_ID) { console.error(`ABORT: resolved(${CLINIC_ID}) != 기대(${EXPECT_CLINIC_ID})`); process.exit(1); }

// ── 0.5) 멱등 가드: 표준 마커 잔존 시 abort ──────────────────────────────
const { data: dup } = await sb.from('reservations').select('id').eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).eq('memo', MARKER);
if (dup?.length) { console.error(`ABORT: 6/13 표준 더미 이미 ${dup.length}건 존재. cleanup 후 재실행.`); process.exit(1); }

// ── 1) CLEANUP: 결함더미 52건 (날짜 한정) ───────────────────────────────
const { data: defective } = await sb.from('reservations').select('id, customer_id, customer_name, memo')
  .eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).in('memo', OLD_MARKERS);
console.log(`\n[cleanup] 6/13 결함더미 대상: ${defective?.length||0}건 (52 기대)`);
if ((defective?.length||0) !== 52) {
  console.error(`ABORT: 결함더미 대상이 52건 아님(${defective?.length}). 수동 점검 필요.`); process.exit(1);
}
const cidSet = (defective||[]).filter(r=>r.customer_id);
if (cidSet.length) { console.error(`ABORT: cleanup 대상 중 customer_id SET ${cidSet.length}건 — 실데이터 혼입 위험.`); process.exit(1); }
const delIds = defective.map(r=>r.id);
const { error: delErr } = await sb.from('reservations').delete().in('id', delIds);
if (delErr) { console.error('cleanup DELETE FAIL:', delErr); process.exit(1); }
console.log(`[cleanup] reservations ${delIds.length}건 DELETE 완료 (연결 customers 없음 — cid NULL 전량)`);

// 실데이터 보존 확인
const { data: remain } = await sb.from('reservations').select('id, memo').eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE);
console.log(`[cleanup] 잔존 6/13 예약: ${remain?.length||0}건 (실데이터 4 기대)`);

// ── 2) 슬롯 13개 (10:00~16:00, 30분) ────────────────────────────────────
const SLOTS = ['10:00:00','10:30:00','11:00:00','11:30:00','12:00:00','12:30:00','13:00:00','13:30:00','14:00:00','14:30:00','15:00:00','15:30:00','16:00:00'];
if (SLOTS.length !== 13) { console.error('SLOT count != 13'); process.exit(1); }
const phone = (seq) => `+8210${PHONE_PREFIX}${String(seq).padStart(4,'0')}`;

// 초진(new) 13 + 재진(returning) 13 — 고유 한국 성명 26개 (6/12 배치와도 다른 이름)
const NEW13 = ['남궁현','여민하','하태경','류서진','방준영','설하람','진우빈','왕도현','한서율','오태인','금민서','노재희','양시후'];
const RET13 = ['차예솔','주아린','전도윤','민채아','홍시언','임수아','조하준','신유리','권태오','황보름','배준석','윤소담','장하늘'];
const allNames = [...NEW13, ...RET13];
if (new Set(allNames).size !== 26) { console.error('후보 이름 중복!', new Set(allNames).size); process.exit(1); }

// 기존 clinic 전체 이름 충돌 검사 (6/08·6/12 더미 + 실고객) → homonym fallback 예방(path 1 보장)
const { data: existing } = await sb.from('customers').select('name').eq('clinic_id', CLINIC_ID).limit(10000);
const existSet = new Set((existing||[]).map(c => c.name));
const collide = allNames.filter(n => existSet.has(n));
if (collide.length) { console.error('기존 clinic 이름과 충돌(동명이인 위험):', collide); process.exit(1); }
console.log(`\n이름 충돌 검사 통과: 후보 26명 전부 신규 (기존 ${existSet.size}명과 무충돌)`);

// ── 3) customers INSERT (is_simulation=false) ───────────────────────────
const custRows = [];
let seq = 0;
NEW13.forEach((name) => { seq++; custRows.push({ clinic_id: CLINIC_ID, name, phone: phone(seq), visit_type: 'new', is_simulation: false, memo: MARKER }); });
RET13.forEach((name) => { seq++; custRows.push({ clinic_id: CLINIC_ID, name, phone: phone(seq), visit_type: 'returning', is_simulation: false, memo: MARKER }); });

console.log(`고객 ${custRows.length}건 INSERT...`);
const { data: custIns, error: ce } = await sb.from('customers').insert(custRows).select('id, name, phone, visit_type, chart_number, is_simulation');
if (ce) { console.error('CUSTOMER INSERT FAIL:', ce); process.exit(1); }
console.log(`고객 INSERT OK: ${custIns.length}건 (is_simulation=true: ${custIns.filter(c=>c.is_simulation).length} — 0 기대, chart_number 결손: ${custIns.filter(c=>!c.chart_number).length})`);

const idByName = {}; custIns.forEach(c => { idByName[c.name] = c.id; });
const phoneByName = {}; custRows.forEach(r => { phoneByName[r.name] = r.phone; });

// ── 4) reservations INSERT (customer_id 직결, NULL 금지) ─────────────────
const resvRows = [];
const log = [];
for (let i = 0; i < 13; i++) {
  const time = SLOTS[i];
  const nm = NEW13[i], rt = RET13[i];
  for (const [name, vt] of [[nm,'new'],[rt,'returning']]) {
    resvRows.push({ clinic_id: CLINIC_ID, customer_id: idByName[name], customer_name: name, customer_phone: phoneByName[name], reservation_date: DATE, reservation_time: time, visit_type: vt, status: 'confirmed', memo: MARKER });
  }
  log.push({ time: time.slice(0,5), 초진: nm, 재진: rt });
}
const nullCid = resvRows.filter(r => !r.customer_id);
if (nullCid.length) {
  console.error('ABORT: customer_id NULL', nullCid.length); await sb.from('customers').delete().in('id', custIns.map(c=>c.id)); process.exit(1);
}
console.log(`예약 ${resvRows.length}건 INSERT...`);
const { data: resvIns, error: re2 } = await sb.from('reservations').insert(resvRows).select('id, customer_name, customer_id, reservation_time, visit_type');
if (re2) { console.error('RESERVATION INSERT FAIL:', re2); await sb.from('customers').delete().in('id', custIns.map(c=>c.id)); console.log('고객 롤백'); process.exit(1); }
console.log(`예약 INSERT OK: ${resvIns.length}건 (customer_id NULL: ${resvIns.filter(r=>!r.customer_id).length})`);

// ── 5) 검증 ──────────────────────────────────────────────────────────────
console.log('\n=== 생성 목록 (시간 | 초진 | 재진) ===');
log.forEach(r => console.log(`${r.time} | 초진:${r.초진} | 재진:${r.재진}`));

const { data: chk } = await sb.from('reservations').select('id, customer_id').eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).eq('memo', MARKER);
console.log(`\nreservations 더미: ${chk?.length}건 (26 기대), cid NULL: ${chk?.filter(r=>!r.customer_id).length} (0 기대)`);
const { data: chkc } = await sb.from('customers').select('id').eq('clinic_id', CLINIC_ID).eq('memo', MARKER).eq('is_simulation', false);
console.log(`customers 더미(is_simulation=false): ${chkc?.length}건 (26 기대)`);
console.log('\n=== APPLY DONE ===');
