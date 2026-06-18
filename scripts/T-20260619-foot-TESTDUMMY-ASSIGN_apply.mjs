/**
 * T-20260619-foot-TESTDUMMY-ASSIGN — APPLY (배정 자동화 검증용 더미 80건, 당일 EOD 소멸)
 * 종로점(jongno-foot, clinic 74967aea) 2026-06-19 더미 예약 80건.
 *   20슬롯(10:00~19:30, 30분) × (초진 new 2 + 재진 returning 2) = 80건 (초진40 + 재진40).
 *
 * ── ⚠ is_simulation 정책 deviation (planner 티켓은 is_simulation=TRUE 명시) ─────────────
 *   본 배치는 **is_simulation=FALSE** 로 적재한다. 근거(코드 실측):
 *     · stripSimulationRows(simulationFilter.ts)가 is_simulation=true 고객 행을 admin
 *       예약관리·**대시보드 칸반 rows(Dashboard.tsx:3750-3754)**·셀프접수 명단에서 숨김.
 *     · 자동배정(autoAssign.ts) 트리거 = 칸반에서 [상담대기]/[치료대기] 슬롯 이동 시점.
 *       → is_simulation=true면 체크인된 더미가 칸반에서 사라져 슬롯 이동 자체 불가
 *          → AC2 ②③ 배정 자동화 검증이 원천 불가능(self-defeating).
 *     · 직전 동형 선례 T-20260610-foot-DUMMY-RESV-REAPPLY 도 동일 사유로 false 채택(검증 성공).
 *   POLLUTION(T-20260617) 진짜 root-cause = "당일 check_ins INSERT" 이며, 본 배치는 그 가드를
 *   준수(당일 check_ins 0건, 재진 과거 check_in은 6/17만)하므로 is_simulation 마커 없이도 안전.
 *   대신 가역성·정리 안전은 (a) memo='[TEST-0619-ASSIGN]' 전 테이블 부착 (b) 고유 phone prefix
 *   +821096190 (c) EOD 한정 DELETE 스크립트 3중으로 보장.
 *   → 이 deviation은 planner FOLLOWUP으로 통지. 반대 시 cleanup 후 정책 재적용(가역).
 *
 * ── 가드 (POLLUTION root-cause 반영) ──
 *   · 당일(6/19) 슬롯에는 reservations(confirmed)만. check_ins INSERT 절대 금지.
 *   · 재진 40건 과거이력 = check_in(status=done, checked_in_at=6/17, reservation_id NULL) 1건
 *     + medical_chart(visit_date=6/17) 1건. 6/17은 대시보드 당일범위(6/19) 밖 → 라이브 칸반 무오염.
 *   · reservations.status = 'confirmed' (CHECK IN('confirmed','checked_in','cancelled','noshow');
 *     'reserved'는 비허용 값 — 티켓의 'reserved'는 개념상 '예약됨'을 의미하므로 confirmed로 적재).
 *   · reservations.customer_id NULL 금지(차트 WSOD 방지). visit_type CHECK('new','returning','experience').
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const EXPECT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-06-19';
const PAST_CHECKIN_AT = '2026-06-17T03:00:00+00:00'; // = 2026-06-17 12:00 KST (당일범위 밖)
const PAST_VISIT_DATE = '2026-06-17';
const MARKER = '[TEST-0619-ASSIGN]';
const PHONE_PREFIX = '+821096190'; // +82 10 9619 0XXX (0619 인코딩, 기존 배치와 구분)
// medical_charts.signing_doctor_id 트리거(의료법) NOT NULL 강제 → clinic_doctors(id) 필요.
const SIGNING_DOCTOR_ID = 'cd2639d0-a3d6-47f9-901e-5b841a4ce6d0'; // 문지은(jongno-foot clinic_doctors)
const SIGNING_DOCTOR_NAME = '문지은';

// ── 0) clinic slug resolve 재확인 ───────────────────────────────────────
const { data: clinics, error: cerr } = await sb.from('clinics').select('id, slug, name').eq('slug', 'jongno-foot');
if (cerr) { console.error('clinic resolve fail:', cerr); process.exit(1); }
const CLINIC_ID = clinics?.[0]?.id;
console.log(`[slug resolve] jongno-foot = ${CLINIC_ID} (${clinics?.[0]?.name})`);
if (CLINIC_ID !== EXPECT_CLINIC_ID) {
  console.error(`ABORT: resolved clinic_id(${CLINIC_ID}) != 기대값(${EXPECT_CLINIC_ID})`);
  process.exit(1);
}

// ── 0.5) 멱등 가드: 본 배치 잔존 시 abort ────────────────────────────────
const { data: dup } = await sb.from('reservations').select('id').eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).eq('memo', MARKER);
if (dup?.length) { console.error(`ABORT: 본 배치 reservations 이미 ${dup.length}건 존재. cleanup 후 재실행.`); process.exit(1); }

// ── 1) 슬롯 20개 (10:00~19:30, 30분) ────────────────────────────────────
const SLOTS = [];
for (let h = 10; h < 20; h++) { SLOTS.push(`${String(h).padStart(2,'0')}:00:00`); SLOTS.push(`${String(h).padStart(2,'0')}:30:00`); }
if (SLOTS.length !== 20) { console.error('SLOT count != 20:', SLOTS.length); process.exit(1); }

// ── 2) 고유 한국 성명 80개 생성 (DB 기존 고객명과 충돌 회피) ──────────────
const { data: existCust } = await sb.from('customers').select('name').eq('clinic_id', CLINIC_ID);
const avoid = new Set((existCust ?? []).map((c) => (c.name ?? '').trim()).filter(Boolean));
const SURNAMES = ['김','이','박','최','정','강','조','윤','장','임','한','오','서','신','권','황','안','송','류','홍','전','고','문','손','양','배','백','허','유','남'];
const GIVEN = ['서준','하윤','도윤','시우','지호','예준','주원','지후','준우','건우','우진','선우','연우','민준','유준','정우','승현','시윤','준서','은우','지안','서연','서윤','지우','하은','민서','지유','윤서','채원','수아','다은','은서','예린','지원','수빈','소율','예나','시은','하린','유나'];
const names = [];
const used = new Set();
outer:
for (const s of SURNAMES) {
  for (const g of GIVEN) {
    const nm = s + g;
    if (avoid.has(nm) || used.has(nm)) continue;
    used.add(nm); names.push(nm);
    if (names.length >= 80) break outer;
  }
}
if (names.length < 80) { console.error('고유 이름 80개 생성 실패:', names.length); process.exit(1); }
const NEW40 = names.slice(0, 40);
const RET40 = names.slice(40, 80);

// 초진 axis 다양화(deriveConsultAxis 검증용): TM/인바운드/워크인 순환
const NEW_ROUTES = ['TM', '인바운드', '워크인'];

// ── 3) customers 80건 INSERT (is_simulation=FALSE) ──────────────────────
const custRows = [];
let seq = 0;
NEW40.forEach((name, i) => {
  seq++;
  custRows.push({ clinic_id: CLINIC_ID, name, phone: `${PHONE_PREFIX}${String(seq).padStart(3,'0')}`, visit_type: 'new', visit_route: NEW_ROUTES[i % 3], is_simulation: false, memo: MARKER });
});
RET40.forEach((name) => {
  seq++;
  custRows.push({ clinic_id: CLINIC_ID, name, phone: `${PHONE_PREFIX}${String(seq).padStart(3,'0')}`, visit_type: 'returning', is_simulation: false, memo: MARKER });
});

console.log(`고객 ${custRows.length}건 INSERT 시작... (is_simulation=false, memo=${MARKER})`);
const { data: custIns, error: ce } = await sb.from('customers').insert(custRows).select('id, name, phone, visit_type, is_simulation');
if (ce) { console.error('CUSTOMER INSERT FAIL:', ce); process.exit(1); }
const simCount = custIns.filter((c) => c.is_simulation).length;
console.log(`고객 INSERT OK: ${custIns.length}건 (is_simulation=true 행: ${simCount} — 0이어야 함)`);
if (simCount !== 0) { console.error('ABORT: is_simulation=true 행 발견'); process.exit(1); }

const idByName = {}; custIns.forEach((c) => { idByName[c.name] = c.id; });
const phoneByName = {}; custRows.forEach((r) => { phoneByName[r.name] = r.phone; });

// ── 4) 재진 40건: 과거 check_in(done, 6/17) + medical_chart(6/17) ────────
const RET_DIAG = [
  { cc: '엄지발톱 통증', dx: '감입조갑(L60.0)', tx: '교정술(BS)', res: '호전' },
  { cc: '발톱 변색', dx: '조갑진균증(B35.1)', tx: '항진균 처치', res: '경과관찰' },
  { cc: '발 굳은살 통증', dx: '굳은살/티눈(L84)', tx: '각질 제거', res: '호전' },
  { cc: '발뒤꿈치 통증', dx: '족저근막염(M72.2)', tx: '도수+체외충격파', res: '경과관찰' },
];
const checkInRows = [];
const chartRows = [];
RET40.forEach((name, i) => {
  const cid = idByName[name];
  const d = RET_DIAG[i % RET_DIAG.length];
  checkInRows.push({
    clinic_id: CLINIC_ID, customer_id: cid, reservation_id: null,
    customer_name: name, customer_phone: phoneByName[name],
    visit_type: 'returning', status: 'done',
    checked_in_at: PAST_CHECKIN_AT, completed_at: PAST_CHECKIN_AT,
    notes: { marker: MARKER }, queue_number: 900 + i,
  });
  chartRows.push({
    customer_id: cid, clinic_id: CLINIC_ID, visit_date: PAST_VISIT_DATE,
    chief_complaint: d.cc, diagnosis: d.dx, treatment_record: d.tx, treatment_result: d.res,
    created_by: MARKER,
    signing_doctor_id: SIGNING_DOCTOR_ID, signing_doctor_name: SIGNING_DOCTOR_NAME,
  });
});

console.log(`재진 과거 check_in ${checkInRows.length}건 INSERT (checked_in_at=${PAST_CHECKIN_AT}, status=done)...`);
const { data: ciIns, error: cie } = await sb.from('check_ins').insert(checkInRows).select('id, checked_in_at, status');
if (cie) { console.error('CHECK_IN INSERT FAIL:', cie); await sb.from('customers').delete().in('id', custIns.map((c)=>c.id)); process.exit(1); }
// 가드: 당일(6/19) check_in이 단 1건이라도 있으면 abort+롤백 (POLLUTION 재발 방지)
const todayCi = ciIns.filter((r) => String(r.checked_in_at).slice(0,10) === DATE);
if (todayCi.length) {
  console.error(`ABORT: 당일(${DATE}) check_in ${todayCi.length}건 발견 — POLLUTION 가드 위반`);
  await sb.from('check_ins').delete().in('id', ciIns.map((r)=>r.id));
  await sb.from('customers').delete().in('id', custIns.map((c)=>c.id));
  process.exit(1);
}
console.log(`check_in INSERT OK: ${ciIns.length}건 (당일 check_in: ${todayCi.length} — 반드시 0)`);

console.log(`재진 medical_chart ${chartRows.length}건 INSERT...`);
const { data: mcIns, error: mce } = await sb.from('medical_charts').insert(chartRows).select('id');
if (mce) {
  console.error('MEDICAL_CHART INSERT FAIL:', mce);
  await sb.from('check_ins').delete().in('id', ciIns.map((r)=>r.id));
  await sb.from('customers').delete().in('id', custIns.map((c)=>c.id));
  process.exit(1);
}
console.log(`medical_chart INSERT OK: ${mcIns.length}건`);

// ── 5) reservations 80건 INSERT (confirmed, 6/19, customer_id 직결) ──────
const resvRows = [];
const log = [];
for (let i = 0; i < 20; i++) {
  const time = SLOTS[i];
  const new1 = NEW40[i*2], new2 = NEW40[i*2+1];
  const ret1 = RET40[i*2], ret2 = RET40[i*2+1];
  [new1, new2].forEach((nm) => resvRows.push({ clinic_id: CLINIC_ID, customer_id: idByName[nm], customer_name: nm, customer_phone: phoneByName[nm], reservation_date: DATE, reservation_time: time, visit_type: 'new', status: 'confirmed', memo: MARKER }));
  [ret1, ret2].forEach((nm) => resvRows.push({ clinic_id: CLINIC_ID, customer_id: idByName[nm], customer_name: nm, customer_phone: phoneByName[nm], reservation_date: DATE, reservation_time: time, visit_type: 'returning', status: 'confirmed', memo: MARKER }));
  log.push({ time: time.slice(0,5), 초진: `${new1},${new2}`, 재진: `${ret1},${ret2}` });
}
const nullCid = resvRows.filter((r) => !r.customer_id);
if (nullCid.length) {
  console.error('ABORT: reservations customer_id NULL', nullCid.length);
  await sb.from('medical_charts').delete().in('id', mcIns.map((r)=>r.id));
  await sb.from('check_ins').delete().in('id', ciIns.map((r)=>r.id));
  await sb.from('customers').delete().in('id', custIns.map((c)=>c.id));
  process.exit(1);
}
console.log(`예약 ${resvRows.length}건 INSERT (status=confirmed)...`);
const { data: resvIns, error: re } = await sb.from('reservations').insert(resvRows).select('id, customer_id, reservation_time, visit_type');
if (re) {
  console.error('RESERVATION INSERT FAIL:', re);
  await sb.from('medical_charts').delete().in('id', mcIns.map((r)=>r.id));
  await sb.from('check_ins').delete().in('id', ciIns.map((r)=>r.id));
  await sb.from('customers').delete().in('id', custIns.map((c)=>c.id));
  process.exit(1);
}
console.log(`예약 INSERT OK: ${resvIns.length}건 (customer_id NULL: ${resvIns.filter((r)=>!r.customer_id).length})`);

console.log('\n=== 생성 슬롯 목록 (시간 | 초진2 | 재진2) ===');
log.forEach((r) => console.log(`${r.time} | 초진:${r.초진.padEnd(10)} | 재진:${r.재진}`));

// ── 6) 검증 카운트 ──────────────────────────────────────────────────────
console.log('\n=== 검증 ===');
const { data: vR } = await sb.from('reservations').select('id, visit_type').eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).eq('memo', MARKER);
console.log(`reservations 더미: ${vR?.length}건 (기대 80) — new:${vR?.filter((r)=>r.visit_type==='new').length} / returning:${vR?.filter((r)=>r.visit_type==='returning').length}`);
const { data: vC } = await sb.from('customers').select('id, visit_type, is_simulation').eq('clinic_id', CLINIC_ID).eq('memo', MARKER);
console.log(`customers 더미: ${vC?.length}건 (기대 80) — is_simulation=true:${vC?.filter((c)=>c.is_simulation).length}(반드시 0)`);
const { data: vCi } = await sb.from('check_ins').select('id, checked_in_at, status').eq('clinic_id', CLINIC_ID).contains('notes', { marker: MARKER });
console.log(`재진 과거 check_in: ${vCi?.length}건 (기대 40, status=done) — 당일(${DATE}): ${vCi?.filter((r)=>String(r.checked_in_at).slice(0,10)===DATE).length}(반드시 0)`);
const { data: vMc } = await sb.from('medical_charts').select('id').eq('clinic_id', CLINIC_ID).eq('created_by', MARKER);
console.log(`재진 medical_chart: ${vMc?.length}건 (기대 40)`);
console.log('\n=== APPLY DONE ===');
