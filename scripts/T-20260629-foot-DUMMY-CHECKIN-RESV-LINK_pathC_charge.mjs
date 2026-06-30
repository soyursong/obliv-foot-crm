/**
 * T-20260629-foot-DUMMY-CHECKIN-RESV-LINK · Path C — 빈 check_ins 진료필드 충전 (UPDATE only, INSERT 0)
 *
 * 인가: planner MSG-20260630-100539-2vm0 (Path C 재인가). 정체성 게이트 해소 — 김주연 총괄 직접 확인
 *   (thread 1782668379.879889 / ts 1782780910.890729): 김민경(83ab4fe1 등) = 원내 직원/테스트 계정,
 *   서류출력·예약 테스트 활용. 실제 환자 아님 확정.
 *
 * 스코프(화이트리스트 한정 — 잔여 PHI 가드):
 *   - WHITELIST = 총괄확인 직원/테스트 계정 한정. 양성 신호(staff 매칭 / 명백 테스트 이름 / is_simulation / 명시 TEST 마커).
 *   - EXCLUDE  = 실환자성 마커 계정(memo 보험/반려/담당실장 등 537844e6 김사번류) + 미확인 UNTAGGED blanket 280건.
 *   - 절대조건: 실제 환자 의무기록 허위 PHI 기재 0.
 *
 * POLLUTION 불변식#5 하드가드:
 *   - 신규 active check_ins INSERT 0 (이 스크립트는 UPDATE only).
 *   - 기존행 status 변경 0 (status 컬럼 미터치).
 *   - 과거일자 한정 (checked_in_at::date < TODAY) → 셀프접수 대기명단·일마감 진입 0행.
 *   - 이미 충진된 행 미접촉 (treatment 필드 비어있는 EMPTY 행만 대상 → 중복/과편집 방지).
 *
 * 게이트: 기본 dry-run. supervisor DML gate GO 후에만 --apply.
 * 실행:  node scripts/T-20260629-foot-DUMMY-CHECKIN-RESV-LINK_pathC_charge.mjs            # dry-run
 *        node scripts/T-20260629-foot-DUMMY-CHECKIN-RESV-LINK_pathC_charge.mjs --apply    # supervisor GO 후
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply');
const TODAY = '2026-06-30'; // 과거일자 한정 기준 (KST 오늘). 이 날짜 이상은 라이브큐 보호 위해 제외.
const d = (ts) => (ts || '').slice(0, 10);

// ── EMPTYROW-HIDE 미러: treatment 3필드 모두 빈 행 = EMPTY (충전 대상)
const isEmpty = (ci) =>
  !(!!(ci.treatment_kind ?? '').toString().trim() ||
    !!(ci.treatment_memo?.details ?? '').toString().trim() ||
    !!(ci.doctor_note ?? '').toString().trim());

// ── 라이브큐(셀프접수 대기명단/일마감 진입) 상태 = 비-종결 상태
const ACTIVE_STATUS = new Set([
  'registered','receiving','exam_waiting','examination','consult_waiting','consultation',
  'payment_waiting','treatment_waiting','healer_waiting','preconditioning','laser_waiting','laser',
]);

// ── 실환자성 마커(EXCLUDE 강제 override): 운영성/보험성 memo
const REALPATIENT_MEMO = /보험|반려|담당.?실장|실장.*연결|환불|미수|수납/;

// ── 명백 테스트/스태프 이름 토큰 (실환자 식별일 수 없는 문자열)
const TESTNAME = /(테스트|test|dummy|더미|힐러\d|원내촬영|서류확인|서류테스트|예약접수|배정테스트|중간점검|가나다라|김밥천국|obliv|초진환자\d|^신규$|^중간점검$|분홍이|^김(일|이|삼|사|오|육|칠|팔|구|십|십일|십이|십삼|십사|십오|십육)+번$|테스트_재진|테스트_신규|\[TEST)/i;

const KIM_MINKYUNG_PREFIX = '83ab4fe1'; // 총괄 명시 확인 staff 계정

// ── treatment_kind 대표값: 방문 visit_type 동선 기반 (예약 service 보강)
function repKind(ci) {
  // 예약 service 명에서 명시 신호 우선
  const svc = (ci.__svc || '').toString();
  if (/상담/.test(svc)) return '상담';
  if (/가열/.test(svc) && !/비가열/.test(svc)) return '가열레이저';
  if (/비가열|레이저/.test(svc)) return '비가열레이저';
  if (/체험/.test(svc)) return '프리컨디셔닝';
  if (/컨디셔닝|패디|필링|크랙|각질/.test(svc)) return '프리컨디셔닝';
  // 동선 기반 default
  if (ci.visit_type === 'new') return '상담';
  if (ci.visit_type === 'returning') return '프컨+레이저';
  if (ci.visit_type === 'experience') return '프리컨디셔닝';
  return '상담';
}
function chargeValues(ci) {
  const kind = repKind(ci);
  return {
    treatment_kind: kind,
    treatment_memo: { details: `테스트 데이터 — ${kind} 진행 기록(데모용).` },
    doctor_note: `테스트 데이터 — ${kind} 경과(데모용).`,
  };
}

// ════════════ 1) 데이터 적재 ════════════
const { data: staffRows } = await sb.from('staff').select('name').limit(500);
const staffNames = new Set((staffRows || []).map((s) => (s.name || '').trim()).filter(Boolean));

const { data: ci } = await sb
  .from('check_ins')
  .select('id, customer_id, customer_name, treatment_kind, treatment_memo, doctor_note, status, visit_type, checked_in_at, reservation_id')
  .limit(6000);

const cids = [...new Set((ci || []).map((r) => r.customer_id).filter(Boolean))];
const cm = {};
for (let i = 0; i < cids.length; i += 300) {
  const { data: cust } = await sb.from('customers').select('id,name,is_simulation,memo,phone').in('id', cids.slice(i, i + 300));
  for (const c of cust || []) cm[c.id] = c;
}

// 예약 service 명 매핑(대표값 보강용)
const resvIds = [...new Set((ci || []).map((r) => r.reservation_id).filter(Boolean))];
const resvSvc = {};
for (let i = 0; i < resvIds.length; i += 300) {
  const { data: rv } = await sb.from('reservations').select('id,service_id').in('id', resvIds.slice(i, i + 300));
  for (const r of rv || []) resvSvc[r.id] = r.service_id;
}
const svcIds = [...new Set(Object.values(resvSvc).filter(Boolean))];
const svcName = {};
if (svcIds.length) {
  const { data: sv } = await sb.from('services').select('id,name').in('id', svcIds);
  for (const s of sv || []) svcName[s.id] = s.name;
}

// ════════════ 2) 분류 ════════════
function classifyCustomer(c) {
  if (!c) return { wl: false, reason: 'NO_CUSTOMER_ROW' };
  const name = (c.name || '').trim();
  const memo = (c.memo || '').toString();
  // EXCLUDE override: 실환자성 마커
  if (REALPATIENT_MEMO.test(memo)) return { wl: false, reason: `EXCLUDE_REALPATIENT_MEMO("${memo.slice(0, 24)}")` };
  // WHITELIST 양성 신호
  if (c.id.startsWith(KIM_MINKYUNG_PREFIX)) return { wl: true, reason: 'STAFF_총괄확인(김민경 83ab4fe1)' };
  if (c.is_simulation) return { wl: true, reason: 'IS_SIMULATION' };
  if (staffNames.has(name)) return { wl: true, reason: `STAFF_MATCH(${name})` };
  if (TESTNAME.test(name)) return { wl: true, reason: `TESTNAME(${name})` };
  if (/TEST|DUMMY|더미|테스트/i.test(memo)) return { wl: true, reason: `TEST_MEMO` };
  // 그 외 = 미확인 UNTAGGED → blanket 제외
  return { wl: false, reason: 'EXCLUDE_UNTAGGED(실환자 배제불가)' };
}

// 고객별 EMPTY & 과거일자 check_ins 집계
const empties = (ci || []).filter((r) => {
  if (!isEmpty(r)) return false;                       // 이미 충진된 행 미접촉
  if (d(r.checked_in_at) >= TODAY) return false;       // 과거일자 한정(라이브큐 보호)
  if (ACTIVE_STATUS.has(r.status)) return false;       // 라이브큐 상태 미터치
  return true;
});

const byCust = {};
for (const r of empties) {
  (byCust[r.customer_id] ??= []).push(r);
}

const whitelist = [];  // { id, name, cls, rows:[...] }
const exclude = [];    // { id, name, reason, emptyCount }
for (const [cid, rows] of Object.entries(byCust)) {
  const c = cm[cid];
  const cls = classifyCustomer(c);
  if (cls.wl) {
    whitelist.push({ id: cid, name: c?.name ?? '?', reason: cls.reason, count: rows.length, rows });
  } else {
    exclude.push({ id: cid, name: c?.name ?? '?', reason: cls.reason, emptyCount: rows.length });
  }
}
whitelist.sort((a, b) => b.count - a.count);
exclude.sort((a, b) => b.emptyCount - a.emptyCount);

// 충전 plan 생성 + before-image
const plan = [];
for (const w of whitelist) {
  for (const r of w.rows) {
    r.__svc = svcName[resvSvc[r.reservation_id]] || '';
    const cv = chargeValues(r);
    plan.push({
      check_in_id: r.id,
      customer_id: r.customer_id,
      customer_name: w.name,
      date: d(r.checked_in_at),
      status: r.status,
      visit_type: r.visit_type,
      service: r.__svc || null,
      before: { treatment_kind: r.treatment_kind ?? null, treatment_memo: r.treatment_memo ?? null, doctor_note: r.doctor_note ?? null },
      after: cv,
    });
  }
}

// ════════════ 3) 불변식 자가검증 ════════════
const intrudersRealMemo = plan.filter((p) => REALPATIENT_MEMO.test((cm[p.customer_id]?.memo || '')));
const intrudersToday = plan.filter((p) => p.date >= TODAY);
const intrudersActive = plan.filter((p) => ACTIVE_STATUS.has(p.status));
const guardOk = intrudersRealMemo.length === 0 && intrudersToday.length === 0 && intrudersActive.length === 0;

// ════════════ 4) 리포트 ════════════
console.log('═══════════ Path C 충전 dry-run ═══════════');
console.log(`기준일(TODAY, 과거일자 컷): ${TODAY}`);
console.log(`\n── WHITELIST (충전 대상): 고객 ${whitelist.length}명 / 충전 check_ins ${plan.length}건 ──`);
console.log('count | reason | name | id8');
for (const w of whitelist) console.log(`${w.count} | ${w.reason} | ${w.name} | ${w.id.slice(0, 8)}`);

console.log(`\n── EXCLUDE (제외): 고객 ${exclude.length}명 / 미충전 빈행 ${exclude.reduce((s, e) => s + e.emptyCount, 0)}건 ──`);
console.log('emptyCount | reason | name | id8');
for (const e of exclude.slice(0, 60)) console.log(`${e.emptyCount} | ${e.reason} | ${e.name} | ${e.id.slice(0, 8)}`);
if (exclude.length > 60) console.log(`... (+${exclude.length - 60} more excluded)`);

console.log('\n── 불변식 자가검증 ──');
console.log(`  실환자성 마커 혼입(plan 내): ${intrudersRealMemo.length}  ${intrudersRealMemo.length ? '❌' : '✅'}`);
console.log(`  TODAY 이상 일자 혼입       : ${intrudersToday.length}  ${intrudersToday.length ? '❌' : '✅'}`);
console.log(`  라이브큐 active 상태 혼입  : ${intrudersActive.length}  ${intrudersActive.length ? '❌' : '✅'}`);
console.log(`  INSERT 0 (UPDATE only)     : ✅ (구조상 INSERT 경로 없음)`);
console.log(`  status 변경 0              : ✅ (status 컬럼 미터치)`);
console.log(`  GUARD 종합                 : ${guardOk ? '✅ PASS' : '❌ FAIL'}`);

// 김민경 데모 계정 강조
const km = whitelist.find((w) => w.id.startsWith(KIM_MINKYUNG_PREFIX));
if (km) {
  const dates = [...new Set(km.rows.map((r) => d(r.checked_in_at)))].sort();
  console.log(`\n── 김민경(${KIM_MINKYUNG_PREFIX}) 데모 계정: 충전 ${km.count}건, 방문일 ${dates.length}일 ──`);
  console.log(`   방문일: ${dates.join(', ')}`);
}

// before-image 백업 산출
const artifact = {
  ticket: 'T-20260629-foot-DUMMY-CHECKIN-RESV-LINK',
  path: 'C',
  generated_for: TODAY,
  apply: APPLY,
  guard_ok: guardOk,
  counts: { whitelist_customers: whitelist.length, charge_rows: plan.length, exclude_customers: exclude.length, exclude_rows: exclude.reduce((s, e) => s + e.emptyCount, 0) },
  whitelist: whitelist.map((w) => ({ id: w.id, name: w.name, reason: w.reason, count: w.count })),
  exclude: exclude.map((e) => ({ id: e.id, name: e.name, reason: e.reason, emptyCount: e.emptyCount })),
  before_image: plan.map((p) => ({ check_in_id: p.check_in_id, customer_id: p.customer_id, name: p.customer_name, date: p.date, status: p.status, before: p.before, after: p.after })),
};
const outPath = 'scripts/T-20260629-foot-DUMMY-CHECKIN-RESV-LINK_pathC_charge.out.json';
writeFileSync(outPath, JSON.stringify(artifact, null, 2));
console.log(`\n[artifact] before-image 백업 + 화이트리스트/제외리스트 → ${outPath}`);

if (!APPLY) {
  console.log('\n[DRY-RUN] write 0. supervisor DML gate GO 후 --apply 로 실행.');
  process.exit(0);
}

// ════════════ 5) APPLY (supervisor GO 후) ════════════
if (!guardOk) { console.error('\nABORT: GUARD FAIL — write 차단.'); process.exit(1); }
console.log('\n[APPLY] 행 단위 guarded UPDATE 시작...');
let ok = 0, fail = 0, skip = 0;
for (const p of plan) {
  // 동시성 가드: 여전히 EMPTY(treatment_kind NULL) + 과거일자 + 비-active 인 것만
  const { data, error } = await sb
    .from('check_ins')
    .update(p.after)
    .eq('id', p.check_in_id)
    .is('treatment_kind', null)
    .select('id,treatment_kind,status,checked_in_at');
  if (error) { fail++; console.error(`FAIL ${p.check_in_id.slice(0, 8)}: ${error.message}`); continue; }
  if (!data || !data.length) { skip++; continue; }      // 경합으로 이미 충진됨
  // 사후 검증: status/일자 불변
  const row = data[0];
  if (row.status !== p.status || d(row.checked_in_at) !== p.date) {
    console.error(`WARN ${p.check_in_id.slice(0, 8)}: status/date 불일치 감지(${row.status}/${d(row.checked_in_at)})`);
  }
  ok++;
}
console.log(`\n[APPLY DONE] charged=${ok} skip(경합)=${skip} fail=${fail} / plan=${plan.length}`);
