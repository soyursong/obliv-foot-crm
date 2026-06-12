/**
 * T-20260612-foot-DUMMY-RESV-0612 — APPLY (prod INSERT 52 customers + 52 reservations)
 * 종로점(jongno-foot, clinic 74967aea) 2026-06-12(오늘) 더미 예약 52건.
 * 13슬롯(13:00~19:00, 30분) × (초진 new 2 + 재진 returning 2) = 52건.
 *
 * ⚠ is_simulation=FALSE (티켓 AC-6은 true로 명시했으나, 6/10 배포 ADMIN-SIM-FILTER(9e065ae)가
 *   is_simulation=true 행을 admin 예약목록/캘린더/대시보드에서 숨김 → true면 AC-1(52건 노출)·
 *   AC-5(차트 클릭검증) 전부 실패. 6/10 REAPPLY 선례와 동일하게 false 사용 + planner FOLLOWUP로
 *   편차 보고. 식별/cleanup은 memo 마커 + phone prefix(+82108812)로 보장).
 *
 * 차트 WSOD 재발 방지 (6/9 TESTDATA 교훈):
 *   - customers + reservations 동시 INSERT, reservations.customer_id 절대 NULL 금지.
 *   - visit_type enum = 'new'/'returning' (CHECK IN('new','returning','experience')).
 *   - clinic_id INSERT 전 slug='jongno-foot' resolve 재확인 (불일치 시 abort).
 *   - clinic 내 동명이인 회피: 기존 801명 + 6/9·6/10 배치 이름과 충돌 검사 후 abort.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const EXPECT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-06-12';
const MARKER = '[TEST-DUMMY 20260612]';
const PHONE_PREFIX = '8812';

// ── 0) slug resolve 재확인 (INSERT 전 필수) ──────────────────────────────
const { data: clinics, error: cerr } = await sb.from('clinics').select('id, slug, name').eq('slug', 'jongno-foot');
if (cerr) { console.error('clinic resolve fail:', cerr); process.exit(1); }
const CLINIC_ID = clinics?.[0]?.id;
console.log(`[slug resolve] jongno-foot = ${CLINIC_ID} (${clinics?.[0]?.name})`);
if (CLINIC_ID !== EXPECT_CLINIC_ID) {
  console.error(`ABORT: resolved clinic_id(${CLINIC_ID}) != 티켓 기대값(${EXPECT_CLINIC_ID})`);
  process.exit(1);
}

// ── 0.5) 멱등 가드: 본 배치 잔존 시 abort (중복 INSERT 방지) ───────────────
const { data: dup } = await sb.from('reservations').select('id').eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).eq('memo', MARKER);
if (dup?.length) { console.error(`ABORT: 6/12 더미 배치 이미 ${dup.length}건 존재. cleanup 후 재실행 필요.`); process.exit(1); }

// ── 1) 슬롯 13개 (13:00~19:00, 30분) ────────────────────────────────────
const SLOTS = ['13:00:00','13:30:00','14:00:00','14:30:00','15:00:00','15:30:00','16:00:00','16:30:00','17:00:00','17:30:00','18:00:00','18:30:00','19:00:00'];
if (SLOTS.length !== 13) { console.error('SLOT count != 13:', SLOTS.length); process.exit(1); }

const phone = (seq) => `+8210${PHONE_PREFIX}${String(seq).padStart(4,'0')}`; // +8210881200XX

// 초진(new) 26 + 재진(returning) 26 — 자연 한국 성명 52개 후보 (기존 충돌 시 abort)
const NEW26 = ['구본혁','명지원','선우진','옥태경','마동훈','피서연','음하늘','제갈민','국지호','탁승우',
               '범주아','반시현','갈예린','봉도현','추하람','감민결','마서후','석나경','편유진','국태리',
               '계성훈','독고윤','어진우','복현주','목채린','초윤서'];
const RET26 = ['빈도훈','어수빈','옥세린','마준혁','피현서','음재인','제하윤','국소율','탁민재','범지후',
               '반예나','갈도윤','봉시은','추가람','감연우','마은별','석준호','편나래','국지완','계서아',
               '독고은','어재현','복태웅','목하린','초민규','선유나'];
const allNames = [...NEW26, ...RET26];
if (new Set(allNames).size !== 52) { console.error('후보 이름 중복!', allNames.length, new Set(allNames).size); process.exit(1); }

// 기존 clinic 전체 이름 + 6/9·6/10 배치와 충돌 검사 (clinic 내 동명이인 → homonym 분기 예방)
const { data: existing } = await sb.from('customers').select('name').eq('clinic_id', CLINIC_ID).limit(5000);
const existSet = new Set((existing||[]).map(c => c.name));
const collide = allNames.filter(n => existSet.has(n));
if (collide.length) { console.error('기존 clinic 이름과 충돌:', collide); process.exit(1); }
console.log(`이름 충돌 검사 통과: 후보 52명 전부 신규 (기존 ${existSet.size}명과 무충돌)`);

const custRows = [];
let seq = 0;
NEW26.forEach((name) => { seq++; custRows.push({ clinic_id: CLINIC_ID, name, phone: phone(seq), visit_type: 'new', is_simulation: false, memo: MARKER }); });
RET26.forEach((name) => { seq++; custRows.push({ clinic_id: CLINIC_ID, name, phone: phone(seq), visit_type: 'returning', is_simulation: false, memo: MARKER }); });

console.log(`고객 ${custRows.length}건 INSERT 시작... (is_simulation=false)`);
const { data: custIns, error: ce } = await sb.from('customers').insert(custRows).select('id, name, phone, visit_type, chart_number, is_simulation');
if (ce) { console.error('CUSTOMER INSERT FAIL:', ce); process.exit(1); }
console.log(`고객 INSERT OK: ${custIns.length}건 (is_simulation=true 행: ${custIns.filter(c=>c.is_simulation).length} — 0이어야 함)`);

const idByName = {}; custIns.forEach(c => { idByName[c.name] = c.id; });
const phoneByName = {}; custRows.forEach(r => { phoneByName[r.name] = r.phone; });

// reservations: 슬롯마다 new2+returning2, customer_id 직결 (NULL 금지)
const resvRows = [];
const log = [];
for (let i = 0; i < 13; i++) {
  const time = SLOTS[i];
  const newA = NEW26[i*2], newB = NEW26[i*2+1];
  const retA = RET26[i*2], retB = RET26[i*2+1];
  for (const [name, vt] of [[newA,'new'],[newB,'new'],[retA,'returning'],[retB,'returning']]) {
    resvRows.push({ clinic_id: CLINIC_ID, customer_id: idByName[name], customer_name: name, customer_phone: phoneByName[name], reservation_date: DATE, reservation_time: time, visit_type: vt, status: 'confirmed', memo: MARKER });
  }
  log.push({ time: time.slice(0,5), 초진: [newA, newB], 재진: [retA, retB] });
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

console.log('\n=== 생성 목록 (시간 | 초진2 | 재진2) ===');
log.forEach(r => console.log(`${r.time} | 초진:${r.초진.join(',')} | 재진:${r.재진.join(',')}`));

console.log('\n=== 검증: 오늘 더미 건수 ===');
const { data: chk } = await sb.from('reservations').select('id').eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).eq('memo', MARKER);
console.log(`reservations 더미: ${chk?.length}건 (기대 52)`);
const { data: chkNew } = await sb.from('reservations').select('id').eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).eq('memo', MARKER).eq('visit_type','new');
const { data: chkRet } = await sb.from('reservations').select('id').eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).eq('memo', MARKER).eq('visit_type','returning');
console.log(`  초진(new): ${chkNew?.length} / 재진(returning): ${chkRet?.length} (각 26 기대)`);
const { data: chkc } = await sb.from('customers').select('id').eq('clinic_id', CLINIC_ID).eq('memo', MARKER).eq('is_simulation', false);
console.log(`customers 더미(is_simulation=false): ${chkc?.length}건 (기대 52)`);
const { data: chkSim } = await sb.from('customers').select('id').eq('clinic_id', CLINIC_ID).eq('memo', MARKER).eq('is_simulation', true);
console.log(`customers 더미(is_simulation=true): ${chkSim?.length}건 (반드시 0 — 필터 숨김 회피)`);
console.log('\n=== DONE ===');
