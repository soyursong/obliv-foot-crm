/**
 * T-20260724-foot-DISTHIST-ASSIGNEE-KKM-EGE-MOVE — STEP 1: FREEZE + ABORT GUARD (READ-ONLY)
 *
 * 배분이력 담당자 소급 이동: 강경민(consultant) → 엄경은 실장(consultant), 8건.
 *
 * 아키텍처 확정(사전 코드조사):
 *   · "배분이력 담당자(배정 실장)" 의 정본 store = check_ins.consultant_id (per-visit).
 *   · 매출·실적 귀속(foot_stats_consultant RPC)은 check_ins.consultant_id 를 read-time 파생
 *     (ticketed_all CTE) → consultant_id 만 UPDATE 하면 매출·실적 귀속이 자동 소급 이동(Option A).
 *     payments/package_payments 원장은 무접점(locked-ledger 유지).
 *
 * 본 스크립트: SELECT-only. PK freeze + abort 가드 + 인접 surface 스코프 + 김주연 test-del disjoint 확인.
 *   data_correction_backfill_sop: 단일 count UPDATE 금지 → 명시 PK IN 열거를 위해 실 PK 확정.
 *   출력 = scripts/T-20260724-...FREEZE.json (freeze 셋 + 원값 스냅샷 → apply/rollback 입력).
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC_SLUG = 'jongno-foot';
const FROM_NAME = '강경민';
const TO_NAME = '엄경은';

// 티켓 대상 8건 (고객명 + 배정일 KST). 구분 = 신규.
const TARGETS = [
  { name: '엄상욱', date: '2026-07-24' },
  { name: '김종민', date: '2026-07-22' },
  { name: '오정길', date: '2026-07-17' },
  { name: '이민태', date: '2026-07-17' }, // F-4552, DESIGNPT-RESET-R2 등장 → 지문 대조
  { name: '최강선', date: '2026-07-17' },
  { name: '백영호', date: '2026-07-14' },
  { name: '이재성', date: '2026-07-14' },
  { name: '이멋진', date: '2026-07-14' }, // test-like → 지문 대조
];

const out = { ts_note: 'read-only freeze', clinic: null, from_staff: null, to_staff: null, targets: [], freeze: [], surfaces: {}, abort: [] };

// 1) clinic
const { data: clinic, error: ce } = await supabase.from('clinics').select('id, name, slug').eq('slug', CLINIC_SLUG).single();
if (ce || !clinic) { console.error('clinics 조회 실패', ce?.message); process.exit(1); }
out.clinic = clinic;
console.log(`clinic: ${clinic.name} (${clinic.id})\n`);

// 2) staff 강경민 / 엄경은 (name 매치 → id·role 확인). 동명이인 staff 가드.
const { data: staffRows, error: se } = await supabase
  .from('staff').select('id, name, role, active, user_id').eq('clinic_id', clinic.id);
if (se) { console.error('staff 조회 실패', se.message); process.exit(1); }
const fromMatches = (staffRows ?? []).filter((s) => (s.name ?? '').trim() === FROM_NAME);
const toMatches = (staffRows ?? []).filter((s) => (s.name ?? '').trim() === TO_NAME);
console.log(`staff '${FROM_NAME}' 매치 ${fromMatches.length}건:`, fromMatches.map((s) => `${s.id}(role=${s.role},active=${s.active})`).join(' , '));
console.log(`staff '${TO_NAME}' 매치 ${toMatches.length}건:`, toMatches.map((s) => `${s.id}(role=${s.role},active=${s.active})`).join(' , '));
if (fromMatches.length !== 1) out.abort.push(`from staff '${FROM_NAME}' 매치 ${fromMatches.length}건 (기대 1)`);
if (toMatches.length !== 1) out.abort.push(`to staff '${TO_NAME}' 매치 ${toMatches.length}건 (기대 1)`);
out.from_staff = fromMatches[0] ?? null;
out.to_staff = toMatches[0] ?? null;
const fromId = fromMatches[0]?.id ?? null;
const toId = toMatches[0]?.id ?? null;

// 김주연(sibling test-del 대상 담당자) staff id — disjoint 확인용
const juyeon = (staffRows ?? []).filter((s) => (s.name ?? '').trim() === '김주연');
console.log(`staff '김주연'(sibling test-del) 매치:`, juyeon.map((s) => s.id).join(',') || '(없음)');
out.surfaces.juyeon_staff_ids = juyeon.map((s) => s.id);

if (!fromId || !toId) { out.abort.push('from/to staff id 미확정 — 진행 불가'); }

// 3) 각 타깃별 check_ins 조회 (customer_name + checked_in_at KST date + consultant_id = 강경민)
//    이름 매칭은 check_ins.customer_name 스냅샷 + customers join 지문 병행.
for (const t of TARGETS) {
  const gte = `${t.date}T00:00:00+09:00`;
  const lt = `${t.date}T23:59:59+09:00`;
  // 해당 날짜의 동명 체크인 전수 (consultant 무관) — 지문/동명이인 관찰
  const { data: allByName, error: e1 } = await supabase
    .from('check_ins')
    .select('id, customer_id, customer_name, consultant_id, therapist_id, status, visit_type, checked_in_at, created_date, customers(name, chart_number)')
    .eq('clinic_id', clinic.id)
    .eq('customer_name', t.name)
    .gte('checked_in_at', gte).lte('checked_in_at', lt);
  if (e1) { console.error(`check_ins 조회 실패 (${t.name})`, e1.message); process.exit(1); }
  const rows = allByName ?? [];
  const byKKM = rows.filter((r) => r.consultant_id === fromId);
  const chartOf = (r) => r.customers?.chart_number ?? null;
  const rec = { ...t, total_on_date: rows.length, kkm_rows: byKKM.length, rows: rows.map((r) => ({
    id: r.id, customer_id: r.customer_id, consultant_id: r.consultant_id, is_kkm: r.consultant_id === fromId,
    is_juyeon: juyeon.some((j) => j.id === r.consultant_id), status: r.status, visit_type: r.visit_type,
    checked_in_at: r.checked_in_at, chart_number: chartOf(r),
  })) };
  out.targets.push(rec);
  console.log(`\n── ${t.name} @${t.date}: 동명 체크인 ${rows.length}건 / 강경민귀속 ${byKKM.length}건`);
  for (const r of rows) {
    console.log(`   ci=${r.id} cust=${r.customer_id} chart=${chartOf(r) ?? '-'} consultant=${r.consultant_id === fromId ? '★강경민' : r.consultant_id} status=${r.status} vt=${r.visit_type} at=${r.checked_in_at}`);
  }
  // freeze 후보 = 강경민 귀속 정확히 1건
  if (byKKM.length === 1) {
    const r = byKKM[0];
    out.freeze.push({ name: t.name, date: t.date, check_in_id: r.id, customer_id: r.customer_id,
      chart_number: chartOf(r), orig_consultant_id: r.consultant_id, status: r.status, visit_type: r.visit_type, checked_in_at: r.checked_in_at });
  } else {
    out.abort.push(`${t.name}@${t.date}: 강경민 귀속 check_in ${byKKM.length}건 (기대 1) — 불일치`);
  }
}

// 4) freeze 셋 무결성 abort 가드
console.log(`\n\n════ FREEZE 요약 ════`);
console.log(`freeze 확정: ${out.freeze.length}건 (기대 8)`);
if (out.freeze.length !== 8) out.abort.push(`freeze 건수 ${out.freeze.length} ≠ 8`);
// 김주연 test-del 대상과 disjoint (freeze 는 전부 강경민 귀속 → 김주연 아님, 구조적 disjoint 재확인)
const juyeonOverlap = out.freeze.filter((f) => juyeon.some((j) => j.id === f.orig_consultant_id));
console.log(`김주연 test-del 대상과 겹침: ${juyeonOverlap.length}건 (기대 0)`);
if (juyeonOverlap.length > 0) out.abort.push(`김주연 test-del disjoint 위반 ${juyeonOverlap.length}건`);

// 5) 인접 surface 스코프 (blast radius) — 이 8 customer 에 대한 다른 attribution store 관찰(무변경)
const custIds = [...new Set(out.freeze.map((f) => f.customer_id).filter(Boolean))];
if (custIds.length) {
  const { data: custs } = await supabase.from('customers')
    .select('id, name, assigned_consultant_id, assigned_counselor_id, designated_therapist_id')
    .in('id', custIds);
  out.surfaces.customers = custs ?? [];
  const kkmDefault = (custs ?? []).filter((c) => c.assigned_consultant_id === fromId || c.assigned_counselor_id === fromId);
  console.log(`\n[surface] customers.assigned_consultant/counselor = 강경민 인 고객: ${kkmDefault.length}건 (go-forward 기본값 축 — 티켓 범위 아님, 관찰만)`);
  kkmDefault.forEach((c) => console.log(`   cust=${c.id} name=${c.name} assigned_consultant=${c.assigned_consultant_id} counselor=${c.assigned_counselor_id}`));

  // packages.consultant_id (heuristic, 대부분 NULL, live read 경로 없음 — 관찰)
  const { data: pkgs, error: pe } = await supabase.from('packages')
    .select('id, customer_id, consultant_id, created_at').in('customer_id', custIds);
  if (!pe) {
    out.surfaces.packages = pkgs ?? [];
    const kkmPkg = (pkgs ?? []).filter((p) => p.consultant_id === fromId);
    console.log(`[surface] packages(이 고객) 총 ${(pkgs ?? []).length}건 · consultant_id=강경민 ${kkmPkg.length}건 (heuristic 컬럼, live read 경로 없음)`);
  } else { out.surfaces.packages_error = pe.message; }

  // assignment_actions (audit) — 이 check_in 들에 대한 강경민 귀속 로그(무변경, 관찰)
  const ciIds = out.freeze.map((f) => f.check_in_id);
  const { data: acts, error: ae } = await supabase.from('assignment_actions')
    .select('id, check_in_id, action_type, role, to_staff_id, from_staff_id, created_at').in('check_in_id', ciIds);
  if (!ae) {
    out.surfaces.assignment_actions = acts ?? [];
    console.log(`[surface] assignment_actions(이 8 check_in) ${(acts ?? []).length}건 (append-only audit — 무변경, 역사 보존)`);
  } else { out.surfaces.assignment_actions_error = ae.message; }
}

// 6) 매출·실적 귀속 before 스냅샷 (foot_stats_consultant, 대상기간 7/14~7/24) — Option A 이동 전후 대사용
const { data: statBefore, error: rpce } = await supabase.rpc('foot_stats_consultant', {
  p_clinic_id: clinic.id, p_from: '2026-07-14', p_to: '2026-07-24',
});
if (!rpce) {
  const kkmStat = (statBefore ?? []).find((r) => r.consultant_id === fromId);
  const egeStat = (statBefore ?? []).find((r) => r.consultant_id === toId);
  out.surfaces.stats_before = { kkm: kkmStat ?? null, ege: egeStat ?? null };
  console.log(`\n[매출·실적 before 7/14~7/24] 강경민:`, JSON.stringify(kkmStat ?? null));
  console.log(`[매출·실적 before 7/14~7/24] 엄경은:`, JSON.stringify(egeStat ?? null));
} else { out.surfaces.stats_before_error = rpce.message; }

// 7) 결론
console.log(`\n\n════ ABORT 가드 ════`);
if (out.abort.length === 0) {
  console.log('✅ abort 조건 없음 — freeze 8건 확정, UPDATE 진행 가능');
} else {
  console.log('⛔ ABORT — UPDATE 중단, planner FOLLOWUP 필요:');
  out.abort.forEach((a) => console.log(`   · ${a}`));
}

const outPath = new URL('./T-20260724-foot-DISTHIST-ASSIGNEE-KKM-EGE-MOVE_FREEZE.json', import.meta.url).pathname;
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\nfreeze 스냅샷 저장: ${outPath}`);
process.exit(out.abort.length === 0 ? 0 : 2);
