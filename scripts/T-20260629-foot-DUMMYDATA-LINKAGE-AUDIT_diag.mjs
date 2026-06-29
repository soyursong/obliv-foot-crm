/**
 * T-20260629-foot-DUMMYDATA-LINKAGE-AUDIT — Phase 0 진단 (READ-ONLY)
 *
 * 목적: 더미데이터 환자여정 4축(방문이력/상담차트/진료차트/진료경과) 연동성 결손 진단.
 * 핵심: H1 vs H2 disambiguate (planner note_2026-06-29).
 *   H1 = 더미 check_ins 행 자체가 0건 → remedy: check_ins backfill (INSERT)
 *   H2 = check_ins 행은 존재하나 treatment_kind·treatment_memo.details·doctor_note 셋 다 비어
 *        visibleVisitHistory 필터(MedicalChartPanel L744-750)가 숨김 → remedy: 기존 행 필드 채움
 *   → 더미 check_ins 행수 & 필드충진율로 판정. 행 존재 시 INSERT 금지(0617 불변식#5 오염 위험).
 * 추가: medical_charts.check_in_id 컬럼 실재 여부 확정(부재 시 ADDITIVE → DA CONSULT).
 *
 * READ-ONLY: SELECT only. 쓰기 0. prod 무영향.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const today = new Date().toISOString().slice(0, 10);
const line = (s = '') => console.log(s);
const H = (s) => { line(); line('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'); line(s); line('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'); };

line(`# DUMMYDATA-LINKAGE-AUDIT  (READ-ONLY)   ${new Date().toISOString()}`);

// ── 0. 스키마 발견: 4축 테이블 컬럼 + medical_charts.check_in_id 실재 ──
H('0. 스키마 발견 (각 테이블 샘플 1행 컬럼)');
async function cols(table) {
  const { data, error } = await sb.from(table).select('*').limit(1);
  if (error) { line(`  ${table}: ERROR ${error.message}`); return null; }
  const c = data?.[0] ? Object.keys(data[0]) : null;
  line(`  ${table}: ${c ? c.join(', ') : '(0 rows — 컬럼 미확인)'}`);
  return c;
}
const ciCols = await cols('check_ins');
const resvCols = await cols('reservations');
const mcCols = await cols('medical_charts');
await cols('customers');

const MC_HAS_CHECKIN_ID = mcCols ? mcCols.includes('check_in_id') : 'UNKNOWN(0 rows)';
line();
line(`  ★ medical_charts.check_in_id 컬럼 실재: ${MC_HAS_CHECKIN_ID}`);
// 0행이어도 컬럼은 존재할 수 있으므로 명시 select로 재확인
{
  const { error } = await sb.from('medical_charts').select('check_in_id').limit(1);
  line(`  ★ medical_charts.check_in_id 명시 select: ${error ? 'COLUMN ABSENT → ' + error.message : 'COLUMN PRESENT'}`);
}

// ── 1. 더미 스코프: is_simulation=true customers ──
H('1. 더미 스코프 (customers.is_simulation=true)');
const { data: dummyCusts, error: dcErr } = await sb
  .from('customers')
  .select('id, name, phone, visit_type, clinic_id')
  .eq('is_simulation', true);
if (dcErr) { line(`  ERROR ${dcErr.message}`); process.exit(1); }
const dummyIds = (dummyCusts || []).map((c) => c.id);
line(`  더미 customers: ${dummyIds.length}명`);
const realCount = (await sb.from('customers').select('id', { count: 'exact', head: true }).eq('is_simulation', false)).count;
line(`  실고객 customers(is_simulation=false): ${realCount}`);
if (dummyIds.length === 0) { line('  더미 0명 — 진단 종료'); process.exit(0); }

// chunk helper (in() 1000 제한)
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
async function fetchAllIn(table, sel, col, ids, extra) {
  let out = [];
  for (const part of chunk(ids, 500)) {
    let q = sb.from(table).select(sel).in(col, part);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) { line(`  ${table} fetch err: ${error.message}`); return out; }
    out = out.concat(data || []);
  }
  return out;
}

// ── 2. 축별 더미 레코드 수 ──
H('2. 더미 customer 기준 축별 레코드 수');
const dResv = await fetchAllIn('reservations', 'id, customer_id, reservation_date, reservation_time, visit_type, status', 'customer_id', dummyIds);
line(`  방문/상담 예약(reservations): ${dResv.length}건`);

const ciSel = 'id, customer_id, checked_in_at, status, visit_type, treatment_kind, treatment_category, treatment_contents, treatment_memo, doctor_note, notes, consultation_done, reservation_id';
const dCheckins = await fetchAllIn('check_ins', ciSel, 'customer_id', dummyIds);
line(`  방문이력/상담탭(check_ins): ${dCheckins.length}건   ${dCheckins.length === 0 ? '◀── H1 신호 (행 0건)' : '◀── 행 존재 → H2 가능성 검사'}`);

const mcSel = mcCols ? mcCols.join(', ') : 'id, customer_id, created_at';
const dCharts = await fetchAllIn('medical_charts', mcSel, 'customer_id', dummyIds);
line(`  진료차트/진료경과(medical_charts): ${dCharts.length}건`);

// ── 3. ★ H1 vs H2 판정: check_ins 필드 충진율 ──
H('3. ★ H1/H2 판정 — 더미 check_ins 필드 충진율');
if (dCheckins.length === 0) {
  line('  더미 check_ins 행수 = 0  →  ❰H1 확정❱  더미가 reservations만 생성, check_ins 미생성.');
  line('  remedy: 과거일자·완료status·라이브큐 0행 가드 하 check_ins backfill (INSERT).');
} else {
  const nonEmpty = (v) => !!(typeof v === 'string' ? v.trim() : v);
  const details = (m) => (m && typeof m === 'object' ? (m.details ?? '') : '');
  const notesTxt = (n) => { if (!n || typeof n !== 'object') return ''; return (n.text || n.memo || ''); };
  let fkKind = 0, fkDetails = 0, fkDoc = 0, fNotes = 0, visiblePass = 0, consultVisible = 0;
  const statusDist = {}, dateBuckets = { past: 0, todayOrFuture: 0 };
  for (const ci of dCheckins) {
    if (nonEmpty(ci.treatment_kind)) fkKind++;
    if (nonEmpty(details(ci.treatment_memo))) fkDetails++;
    if (nonEmpty(ci.doctor_note)) fkDoc++;
    if (nonEmpty(notesTxt(ci.notes))) fNotes++;
    // visibleVisitHistory 필터 재현 (MedicalChartPanel L749-750)
    if (nonEmpty(ci.treatment_kind) || nonEmpty(details(ci.treatment_memo)) || nonEmpty(ci.doctor_note)) visiblePass++;
    // ConsultRecordTab 가시성 (status != cancelled)
    if (ci.status !== 'cancelled') consultVisible++;
    statusDist[ci.status] = (statusDist[ci.status] || 0) + 1;
    const d = (ci.checked_in_at || '').slice(0, 10);
    if (d && d < today) dateBuckets.past++; else dateBuckets.todayOrFuture++;
  }
  const pct = (n) => `${n}/${dCheckins.length} (${((n / dCheckins.length) * 100).toFixed(1)}%)`;
  line(`  treatment_kind 채워짐:        ${pct(fkKind)}`);
  line(`  treatment_memo.details 채워짐: ${pct(fkDetails)}`);
  line(`  doctor_note 채워짐:           ${pct(fkDoc)}`);
  line(`  notes.text/memo 채워짐:       ${pct(fNotes)}  (ConsultRecordTab 표시 소스)`);
  line();
  line(`  → visibleVisitHistory 통과(방문이력 노출):  ${pct(visiblePass)}`);
  line(`  → ConsultRecordTab 노출(status≠cancelled): ${pct(consultVisible)}`);
  line();
  line(`  check_ins status 분포: ${JSON.stringify(statusDist)}`);
  line(`  check_ins 일자 분포: 과거=${dateBuckets.past}, 오늘/미래=${dateBuckets.todayOrFuture}  (라이브큐 오염 위험은 오늘/미래·registered)`);
  line();
  if (visiblePass === 0 && consultVisible > 0) {
    line('  ❰H2 확정❱ check_ins 행 존재 + 상담탭 노출(many) 하나 visibleVisitHistory 통과 0 → 방문이력 0.');
    line('  remedy: INSERT 금지(0617 불변식#5). 기존 check_ins에 treatment_kind/treatment_memo.details 채움(시드 보정).');
  } else if (visiblePass > 0) {
    line('  ◀ 일부 visibleVisitHistory 통과 — 방문이력이 일부 보임. 완전 0이 아니면 호소 원인 재확인 필요.');
  } else {
    line('  ◀ 혼합/예외 — 상담탭도 0 & 방문이력 0. 표시문제 아닌 데이터 부재. 케이스별 검토.');
  }
}

// ── 4. medical_charts.check_in_id 연결 상태 ──
H('4. 진료경과(medical_charts) check_in_id 연결 상태');
if (MC_HAS_CHECKIN_ID === true || mcCols?.includes('check_in_id')) {
  let nullLink = 0, linked = 0;
  for (const mc of dCharts) { if (mc.check_in_id == null) nullLink++; else linked++; }
  line(`  더미 medical_charts: ${dCharts.length}건 / check_in_id NULL: ${nullLink} / 연결됨: ${linked}`);
} else {
  line('  medical_charts.check_in_id 컬럼 부재 → ADDITIVE 신규컬럼 필요. planner FOLLOWUP + DA CONSULT + supervisor DDL-diff 재게이트(autonomy §3.1).');
}

// ── 5. 환자×날짜 4축 정합 샘플 (결손 패턴 시각화) ──
H('5. 더미 환자×날짜 4축 정합 샘플 (상위 8명)');
function byDate(rows, dateField) {
  const m = {};
  for (const r of rows) {
    const cid = r.customer_id;
    const d = (r[dateField] || '').slice(0, 10) || '(nodate)';
    ((m[cid] ??= {})[d] ??= 0); m[cid][d]++;
  }
  return m;
}
const resvByCD = byDate(dResv, 'reservation_date');
const ciByCD = byDate(dCheckins, 'checked_in_at');
const mcDateField = mcCols?.includes('chart_date') ? 'chart_date' : (mcCols?.includes('created_at') ? 'created_at' : 'created_at');
const mcByCD = byDate(dCharts, mcDateField);
const sample = (dummyCusts || []).filter((c) => mcByCD[c.id] || ciByCD[c.id]).slice(0, 8);
if (sample.length === 0) line('  (medical_charts/check_ins 보유 더미 환자 없음)');
for (const c of sample) {
  line(`  ▸ ${c.name} (${c.id.slice(0, 8)})`);
  const dates = new Set([...Object.keys(resvByCD[c.id] || {}), ...Object.keys(ciByCD[c.id] || {}), ...Object.keys(mcByCD[c.id] || {})]);
  for (const d of [...dates].sort()) {
    const rv = resvByCD[c.id]?.[d] || 0;
    const ci = ciByCD[c.id]?.[d] || 0;
    const mc = mcByCD[c.id]?.[d] || 0;
    const flag = (ci === 0 && (rv > 0 || mc > 0)) ? '  ⚠️방문이력0(앵커끊김)' : '';
    line(`      ${d}: 예약 ${rv} / 방문(checkin) ${ci} / 진료차트 ${mc}${flag}`);
  }
}

H('진단 종료 (쓰기 0 — READ-ONLY)');
