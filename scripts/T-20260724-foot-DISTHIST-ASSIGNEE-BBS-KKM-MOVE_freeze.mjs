/**
 * T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE — STEP 1: FREEZE + ABORT GUARD (READ-ONLY)
 *
 * 배분이력 담당자 소급 이동: 백범석(consultant) → 강경민(consultant),
 * 금일(2026-07-24 KST) 배정 전체(명시 name 리스트 없음 → 실 PK 열거로 freeze).
 *
 * 아키텍처 확정(sibling KKM-EGE 코드조사 계승):
 *   · "배분이력 담당자(배정 실장)" 정본 store = check_ins.consultant_id (per-visit).
 *   · 매출·실적 귀속(foot_stats_consultant RPC)은 check_ins.consultant_id 를 read-time 파생.
 *     → consultant_id 만 UPDATE 하면 배분이력·배정목록·직원별누적·매출/실적 귀속이 동시 소급 이동.
 *       (foot 에는 별도 저장 귀속 컬럼이 없어 "배분이력 display만 / 매출귀속은 hold" 로 분리 불가 —
 *        본 사실을 완료회신에서 planner 에 명시. confirm-gate #2 재판단 요청.)
 *     payments/package_payments 원장은 무접점(locked-ledger 유지).
 *
 * 본 스크립트: SELECT-only. PK freeze + abort 가드 + test-like 지문 + 김주연 test-del disjoint
 *   + sibling KKM-EGE 원래 8건 명시셋(name+date) 비충돌 cross-guard 확인.
 *   출력 = scripts/T-20260724-...BBS-KKM-MOVE_FREEZE.json (freeze 셋 + 원값 스냅샷 → apply/rollback 입력).
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC_SLUG = 'jongno-foot';
const FROM_NAME = '백범석';
const TO_NAME = '강경민';
const TARGET_DATE = '2026-07-24'; // KST 금일 배정

// sibling KKM-EGE 원래 8건 명시셋 (name+date) — 백범석발 신규 강경민이 이 셋에 충돌하지 않음을 확인
const KKM_EGE_ORIGINAL_8 = [
  { name: '엄상욱', date: '2026-07-24' }, { name: '김종민', date: '2026-07-22' },
  { name: '오정길', date: '2026-07-17' }, { name: '이민태', date: '2026-07-17' },
  { name: '최강선', date: '2026-07-17' }, { name: '백영호', date: '2026-07-14' },
  { name: '이재성', date: '2026-07-14' }, { name: '이멋진', date: '2026-07-14' },
];

const out = { ts_note: 'read-only freeze', target_date: TARGET_DATE, clinic: null, from_staff: null, to_staff: null,
  candidates: [], freeze: [], surfaces: {}, cross_guard: {}, abort: [] };

// 1) clinic
const { data: clinic, error: ce } = await supabase.from('clinics').select('id, name, slug').eq('slug', CLINIC_SLUG).single();
if (ce || !clinic) { console.error('clinics 조회 실패', ce?.message); process.exit(1); }
out.clinic = clinic;
console.log(`clinic: ${clinic.name} (${clinic.id})\n`);

// 2) staff 백범석(from) / 강경민(to) / 김주연(sibling test-del) — name→id·role, 동명이인 가드
const { data: staffRows, error: se } = await supabase
  .from('staff').select('id, name, role, active, user_id').eq('clinic_id', clinic.id);
if (se) { console.error('staff 조회 실패', se.message); process.exit(1); }
const matchOf = (nm) => (staffRows ?? []).filter((s) => (s.name ?? '').trim() === nm);
const fromMatches = matchOf(FROM_NAME);
const toMatches = matchOf(TO_NAME);
const juyeon = matchOf('김주연');
console.log(`staff '${FROM_NAME}'(from) 매치 ${fromMatches.length}건:`, fromMatches.map((s) => `${s.id}(role=${s.role},active=${s.active})`).join(' , ') || '(없음)');
console.log(`staff '${TO_NAME}'(to) 매치 ${toMatches.length}건:`, toMatches.map((s) => `${s.id}(role=${s.role},active=${s.active})`).join(' , ') || '(없음)');
console.log(`staff '김주연'(sibling test-del) 매치:`, juyeon.map((s) => s.id).join(',') || '(없음)');
if (fromMatches.length !== 1) out.abort.push(`from staff '${FROM_NAME}' 매치 ${fromMatches.length}건 (기대 1)`);
if (toMatches.length !== 1) out.abort.push(`to staff '${TO_NAME}' 매치 ${toMatches.length}건 (기대 1)`);
out.from_staff = fromMatches[0] ?? null;
out.to_staff = toMatches[0] ?? null;
out.surfaces.juyeon_staff_ids = juyeon.map((s) => s.id);
const fromId = fromMatches[0]?.id ?? null;
const toId = toMatches[0]?.id ?? null;
if (!fromId || !toId) { out.abort.push('from/to staff id 미확정 — 진행 불가'); }

// 3) 금일 배정 전체 중 consultant_id = 백범석 → 실 PK 열거 (단일 count UPDATE 금지, 명시 freeze)
const gte = `${TARGET_DATE}T00:00:00+09:00`;
const lt = `${TARGET_DATE}T23:59:59+09:00`;
let candRows = [];
if (fromId) {
  const { data: cand, error: e1 } = await supabase
    .from('check_ins')
    .select('id, customer_id, customer_name, consultant_id, therapist_id, status, visit_type, checked_in_at, created_date, customers(name, chart_number)')
    .eq('clinic_id', clinic.id)
    .eq('consultant_id', fromId)
    .gte('checked_in_at', gte).lte('checked_in_at', lt);
  if (e1) { console.error('check_ins(백범석 금일) 조회 실패', e1.message); process.exit(1); }
  candRows = cand ?? [];
}
console.log(`\n── 금일(${TARGET_DATE}) consultant=백범석 check_ins: ${candRows.length}건`);
for (const r of candRows) {
  const chart = r.customers?.chart_number ?? '-';
  console.log(`   ci=${r.id} cust=${r.customer_id} name=${r.customer_name} chart=${chart} status=${r.status} vt=${r.visit_type} at=${r.checked_in_at}`);
  out.candidates.push({ id: r.id, customer_id: r.customer_id, customer_name: r.customer_name,
    chart_number: chart, status: r.status, visit_type: r.visit_type, checked_in_at: r.checked_in_at });
  // freeze = 백범석 귀속 그대로 (정본 명시 PK)
  out.freeze.push({ name: r.customer_name, date: TARGET_DATE, check_in_id: r.id, customer_id: r.customer_id,
    chart_number: chart, orig_consultant_id: r.consultant_id, status: r.status, visit_type: r.visit_type, checked_in_at: r.checked_in_at });
}

// 4) abort 가드
console.log(`\n════ FREEZE 요약 ════`);
console.log(`freeze 확정(백범석 금일 배정): ${out.freeze.length}건`);
if (out.freeze.length === 0) out.abort.push('freeze 0건 — 금일 백범석 배정 없음 (이동 대상 없음, NO-OP)');
// 4a) test-like 지문: 고객명 test 패턴 / chart 없음 / customers join 결손
const testLike = out.freeze.filter((f) => /test|테스트|샘플|더미|dummy/i.test(f.name ?? '') || !f.chart_number || f.chart_number === '-');
if (testLike.length) {
  console.log(`⚠ test-like/지문의심 ${testLike.length}건:`, testLike.map((f) => `${f.name}(${f.chart_number})`).join(', '));
  out.surfaces.test_like = testLike;
  out.abort.push(`test-like/지문의심 ${testLike.length}건 — 실환자 여부 재확인 필요`);
}
// 4b) 김주연 test-del disjoint (백범석 귀속이므로 구조적 disjoint, 재확인)
const juyeonOverlap = out.freeze.filter((f) => juyeon.some((j) => j.id === f.orig_consultant_id));
console.log(`김주연 test-del 대상과 겹침: ${juyeonOverlap.length}건 (기대 0)`);
if (juyeonOverlap.length > 0) out.abort.push(`김주연 test-del disjoint 위반 ${juyeonOverlap.length}건`);

// 5) cross-guard: 백범석발 freeze 셋이 sibling KKM-EGE 원래 8건 명시셋(name+date)과 충돌하지 않음
const collisions = out.freeze.filter((f) => KKM_EGE_ORIGINAL_8.some((k) => k.name === f.name && k.date === f.date));
out.cross_guard = {
  kkm_ege_original_8: KKM_EGE_ORIGINAL_8,
  bbs_freeze_keys: out.freeze.map((f) => ({ name: f.name, date: f.date })),
  collisions,
  note: 'KKM-EGE 대상 = 원래 강경민 8건 명시셋(name+date)에 앵커. 백범석발 신규 강경민(→본건 UPDATE 후 강경민 귀속)이 그 8건 명시셋과 (name+date) 매칭 시 KKM-EGE 재조회에 휩쓸릴 위험. 충돌 0 이면 안전.',
};
console.log(`\n[cross-guard] KKM-EGE 원래 8건과 (name+date) 충돌: ${collisions.length}건 (기대 0)`);
if (collisions.length) {
  console.log('   충돌:', collisions.map((c) => `${c.name}@${c.date}`).join(', '));
  out.abort.push(`KKM-EGE 원래 8건과 name+date 충돌 ${collisions.length}건 — 백범석발이 엄경은으로 잘못 휩쓸릴 위험`);
}

// 6) 매출·실적 before 스냅샷 (foot_stats_consultant, 7/24) — 이동 전후 대사용
const { data: statBefore, error: rpce } = await supabase.rpc('foot_stats_consultant', {
  p_clinic_id: clinic.id, p_from: TARGET_DATE, p_to: TARGET_DATE,
});
if (!rpce) {
  const bbsStat = (statBefore ?? []).find((r) => r.consultant_id === fromId);
  const kkmStat = (statBefore ?? []).find((r) => r.consultant_id === toId);
  out.surfaces.stats_before = { bbs: bbsStat ?? null, kkm: kkmStat ?? null };
  console.log(`\n[매출·실적 before ${TARGET_DATE}] 백범석:`, JSON.stringify(bbsStat ?? null));
  console.log(`[매출·실적 before ${TARGET_DATE}] 강경민:`, JSON.stringify(kkmStat ?? null));
} else { out.surfaces.stats_before_error = rpce.message; }

// 7) 결론
console.log(`\n\n════ ABORT 가드 ════`);
if (out.abort.length === 0) {
  console.log(`✅ abort 조건 없음 — freeze ${out.freeze.length}건 확정, UPDATE 진행 가능`);
} else {
  console.log('⛔ ABORT — UPDATE 중단, planner FOLLOWUP 필요:');
  out.abort.forEach((a) => console.log(`   · ${a}`));
}

const outPath = new URL('./T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE_FREEZE.json', import.meta.url).pathname;
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\nfreeze 스냅샷 저장: ${outPath}`);
process.exit(out.abort.length === 0 ? 0 : 2);
