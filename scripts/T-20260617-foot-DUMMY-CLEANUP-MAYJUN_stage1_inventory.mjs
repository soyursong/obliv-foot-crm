/**
 * T-20260617-foot-DUMMY-CLEANUP-MAYJUN — Stage 1 더미 식별 인벤토리 (READ-ONLY, prod-safe)
 *
 * 목적(umbrella):
 *   2026-05-01 ~ 06-17 jongno-foot 전체 테스트 더미 고객 + 연관 레코드를 식별·카운트.
 *   "싹 다 날려줘"(김주연 총괄) 범위확장 요청 → Stage2 현장 명단 확인용 후보 인벤토리 산출.
 *
 * ⚠ 어떤 write 도 하지 않음. SELECT only. (Stage3 DELETE 는 별도 supervisor DML gate)
 *
 * 다중 마커(AC Stage1-1):
 *   M1 sim       : customers.is_simulation = TRUE              (정규 더미도구 마킹분)
 *   M2 memo      : customers.memo 에 TEST/DUMMY/더미/테스트 류
 *   M3 phone     : phone 테스트 시퀀스(+82100… / +8210881[24]… / 0000·1111111·1234567 류)
 *   M4 name      : 이름 테스트 패턴(테스트/더미/홍길동/test/dummy/가나다/검증/차트 류)
 *   M5 batch     : created_at 동일 분(minute) ≥5건 한방 batch 클러스터
 *
 * 관련티켓 reconcile(이중 카운트 방지):
 *   CHARTTEST(6/14): memo='[TEST-DUMMY 20260614]' + phone +82108814%
 *   RESV-0612(6/12): memo 마커 + phone +82108812%
 *   POLLUTION(6/17): check_ins 10:08 배치 30건(reservation_id NULL·status registered) — 별도 Stage3 진행중
 *   D1-TESTDATA    : blocked(키 미상) — 후보에 잡히면 표기
 *
 * 실행: node scripts/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage1_inventory.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const sb = createClient(
  'https://rxlomoozakkjesdqjtvd.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg',
  { auth: { persistSession: false } },
);
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
// 윈도: 2026-05-01 00:00 KST ~ 2026-06-18 00:00 KST (6/17 전일 포함)
const WIN_FROM = '2026-04-30T15:00:00Z';
const WIN_TO   = '2026-06-17T15:00:00Z';

// 실환자 가드 — 절대 더미 후보로 분류 금지(체험단 오분류 전례).
const REAL_PATIENT_NAMES = ['윤민희', '김진화', '이시형'];

const T = (ts) => (ts ? new Date(new Date(ts).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '-');
const NAME_RX = /테스트|더미|홍길동|가나다|검증|차트테스트|^차트|test|dummy|asdf|ㅁㄴㅇ|ㅋㅋ|abc|zzz/i;
const PHONE_TEST = (p) => {
  if (!p) return false;
  const d = String(p);
  return /^\+?82?100000?/.test(d)          // 010-000X
    || /^\+?82?10881[24]/.test(d)           // CHARTTEST/0612 prefix
    || /0000\d{3,4}$/.test(d)
    || /1111111|2222222|1234567|0000000/.test(d)
    || /^\+?82?10(\d)\1{6,}/.test(d);        // 같은 숫자 반복
};
const MEMO_RX = /TEST|DUMMY|더미|테스트/i;

// customer_id 직접 보유 연관 테이블(POLLUTION 스크립트 실측 기반)
const CUST_REF_TABLES = [
  'reservations', 'check_ins', 'payments', 'packages', 'package_payments',
  'medical_charts', 'consent_forms', 'checklists', 'clinical_images',
  'insurance_claims', 'insurance_documents', 'insurance_receipts',
  'form_submissions', 'health_q_results', 'health_q_tokens',
  'customer_special_notes', 'customer_treatment_memos', 'chart_doctor_memos',
  'message_logs', 'notification_logs', 'notification_opt_outs', 'scheduled_messages',
  'prescriptions', 'rx_audit_log', 'payment_code_claims', 'service_charges',
  'notifications',
];
// check_in_id 경유(비-CASCADE) 자식
const CHECKIN_CHILD = ['package_sessions', 'payments', 'consent_forms', 'checklists', 'insurance_documents', 'notifications', 'check_in_services', 'status_transitions'];

async function countIn(table, col, ids) {
  if (!ids.length) return 0;
  let total = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { count, error } = await sb.from(table).select(col, { count: 'exact', head: true }).in(col, ids.slice(i, i + 100));
    if (error) return `ERR:${(error.message || error.code || '?').slice(0, 40)}`;
    total += count ?? 0;
  }
  return total;
}

async function fetchAll(table, sel, applyFilters) {
  let all = [], from = 0; const PAGE = 1000;
  for (;;) {
    let q = sb.from(table).select(sel).range(from, from + PAGE - 1);
    q = applyFilters(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    all = all.concat(data ?? []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function main() {
  console.log(`== Stage1 더미 인벤토리 (READ-ONLY) ==`);
  console.log(`clinic=jongno-foot(${CLINIC.slice(0, 8)}…) 윈도=2026-05-01~06-17 KST\n`);

  // 1) 윈도 내 전체 고객 적재
  const customers = await fetchAll('customers', 'id, name, phone, visit_type, is_simulation, memo, created_at, created_by',
    (q) => q.eq('clinic_id', CLINIC).gte('created_at', WIN_FROM).lt('created_at', WIN_TO).order('created_at'));
  console.log(`[A] 윈도 내 jongno-foot 고객 총 ${customers.length}건`);

  // 2) created_at 분 단위 batch 클러스터 탐지
  const byMin = {};
  for (const c of customers) { const k = T(c.created_at); (byMin[k] ??= []).push(c.id); }
  const batchMinutes = new Set(Object.entries(byMin).filter(([, ids]) => ids.length >= 5).map(([k]) => k));
  const batchIds = new Set(Object.entries(byMin).filter(([, ids]) => ids.length >= 5).flatMap(([, ids]) => ids));

  // 3) 마커 분류
  const classified = customers.map((c) => {
    const markers = [];
    if (c.is_simulation === true) markers.push('sim');
    if (c.memo && MEMO_RX.test(c.memo)) markers.push('memo');
    if (PHONE_TEST(c.phone)) markers.push('phone');
    if (c.name && NAME_RX.test(c.name)) markers.push('name');
    if (batchIds.has(c.id)) markers.push('batch');
    const isReal = REAL_PATIENT_NAMES.includes((c.name ?? '').trim());
    // 신뢰도: HIGH = sim|memo|(phone&name) ; MED = 단일 phone/name/batch ; 실환자=EXCLUDE
    let conf = 'NONE';
    if (markers.includes('sim') || markers.includes('memo') || (markers.includes('phone') && markers.includes('name'))) conf = 'HIGH';
    else if (markers.includes('phone') || markers.includes('name')) conf = 'MED';
    else if (markers.includes('batch')) conf = 'LOW';
    if (isReal) conf = 'EXCLUDE-REAL';
    return { ...c, markers, conf, isReal };
  });

  const candidates = classified.filter((c) => c.markers.length > 0 && !c.isReal);
  const realHits = classified.filter((c) => c.isReal);
  console.log(`[B] 마커 1개 이상 hit 후보 ${candidates.length}건 (실환자 제외 ${realHits.length}건)`);
  const byConf = {};
  for (const c of candidates) byConf[c.conf] = (byConf[c.conf] ?? 0) + 1;
  console.log(`[C] 신뢰도 분포:`, JSON.stringify(byConf));
  console.log(`    batch 클러스터 분(≥5건):`, [...batchMinutes].join(', ') || '없음');

  // 4) 관련티켓 매핑
  const tag = (c) => {
    const tags = [];
    const ph = String(c.phone ?? '');
    if (/^\+?82?10881[4]/.test(ph) || (c.memo && /\[TEST-DUMMY 20260614\]/.test(c.memo))) tags.push('CHARTTEST');
    if (/^\+?82?10881[2]/.test(ph)) tags.push('RESV-0612');
    return tags;
  };
  candidates.forEach((c) => { c.related = tag(c); });
  const chartTest = candidates.filter((c) => c.related.includes('CHARTTEST'));
  const resv0612 = candidates.filter((c) => c.related.includes('RESV-0612'));
  console.log(`[D] 관련티켓 매핑: CHARTTEST=${chartTest.length} / RESV-0612=${resv0612.length}`);

  // 5) POLLUTION 6/17 10:08 배치 check_ins 30건 reconcile (별도 Stage3)
  const { data: pollCI } = await sb.from('check_ins')
    .select('id, customer_id, customer_name, status, created_at, checked_in_at, reservation_id')
    .eq('clinic_id', CLINIC).is('reservation_id', null).eq('status', 'registered')
    .gte('created_at', '2026-06-17T01:08:00Z').lt('created_at', '2026-06-17T01:09:00Z');
  const pollCustIds = new Set((pollCI ?? []).map((c) => c.customer_id).filter(Boolean));
  console.log(`[E] POLLUTION 10:08 배치 check_ins ${pollCI?.length ?? 0}건 (cust ${pollCustIds.size}개) — 별도 Stage3 진행중, 실행시점 단일화`);
  // 이 고객들이 위 후보에 잡혔는지(이중 카운트 표시)
  const overlapPoll = candidates.filter((c) => pollCustIds.has(c.id));
  candidates.forEach((c) => { if (pollCustIds.has(c.id)) c.related = [...(c.related ?? []), 'POLLUTION']; });
  console.log(`    그중 본 후보와 겹침 ${overlapPoll.length}건`);

  // 6) 연관 레코드 카운트 (customer_id 직접 보유 테이블)
  const candIds = candidates.map((c) => c.id);
  console.log(`\n── [F] 연관 레코드 카운트 (후보 ${candIds.length} customer_id 기준) ──`);
  const refCounts = {};
  for (const t of CUST_REF_TABLES) {
    refCounts[t] = await countIn(t, 'customer_id', candIds);
    if (refCounts[t] !== 0) console.log(`  ${t}: ${refCounts[t]}`);
  }
  const noColTables = Object.entries(refCounts).filter(([, v]) => typeof v === 'string').map(([t]) => t);
  if (noColTables.length) console.log(`  (customer_id 컬럼 없음/오류: ${noColTables.join(', ')})`);

  // 6b) check_ins 자식(check_in_id 경유) — 후보 고객의 check_ins id 모아 카운트
  let candCI = [];
  for (let i = 0; i < candIds.length; i += 100) {
    const { data } = await sb.from('check_ins').select('id').eq('clinic_id', CLINIC).in('customer_id', candIds.slice(i, i + 100));
    candCI = candCI.concat((data ?? []).map((r) => r.id));
  }
  console.log(`\n── [G] check_ins 자식(check_in_id 경유, 후보 check_ins ${candCI.length}개 기준) ──`);
  const childCounts = {};
  for (const t of CHECKIN_CHILD) {
    childCounts[t] = await countIn(t, 'check_in_id', candCI);
    if (childCounts[t] !== 0) console.log(`  ${t}: ${childCounts[t]}`);
  }

  // 6c) daily_closings 영향 (집계 — 더미 check_ins/payments 포함 날짜)
  const { data: dc } = await sb.from('daily_closings')
    .select('close_date, status, single_cash_total, single_card_total, actual_cash_total, actual_card_total')
    .eq('clinic_id', CLINIC).gte('close_date', '2026-05-01').lte('close_date', '2026-06-17').order('close_date');
  console.log(`\n── [H] daily_closings(5/1~6/17 jongno-foot) ${dc?.length ?? 0}행 (집계 1행/일, 개별 고객행 없음) ──`);
  if (dc?.length) for (const r of dc) console.log(`  ${r.close_date} status=${r.status} 단품현금=${r.single_cash_total ?? 0} 실수금카드=${r.actual_card_total ?? 0}`);

  // 7) 후보 명단 출력 (HIGH/MED 전체, LOW 요약)
  console.log(`\n── [I] 더미 후보 명단 (HIGH·MED) ──`);
  const ordered = [...candidates].sort((a, b) => ({ HIGH: 0, MED: 1, LOW: 2 }[a.conf] - { HIGH: 0, MED: 1, LOW: 2 }[b.conf]) || a.created_at.localeCompare(b.created_at));
  for (const c of ordered.filter((c) => c.conf !== 'LOW')) {
    console.log(`  [${c.conf}] ${c.name} | ${c.phone ?? '-'} | created=${T(c.created_at)} | mk=${c.markers.join('+')} | rel=${(c.related ?? []).join(',') || '-'} | id=${c.id.slice(0, 8)}`);
  }
  const lowRows = ordered.filter((c) => c.conf === 'LOW');
  if (lowRows.length) {
    console.log(`\n  ── LOW(batch만, 약한 마커 — 현장 확인 필요) ${lowRows.length}건 ──`);
    for (const c of lowRows.slice(0, 60)) console.log(`  [LOW] ${c.name} | ${c.phone ?? '-'} | created=${T(c.created_at)} | id=${c.id.slice(0, 8)}`);
  }
  if (realHits.length) {
    console.log(`\n  ── ⚠ 실환자 가드(후보에서 제외됨) ──`);
    for (const c of realHits) console.log(`  [EXCLUDE] ${c.name} | ${c.phone ?? '-'} | created=${T(c.created_at)} | is_sim=${c.is_simulation}`);
  }

  // 8) evidence JSON + 명단 파일
  mkdirSync('db-gate', { recursive: true });
  const evidence = {
    ticket: 'T-20260617-foot-DUMMY-CLEANUP-MAYJUN', stage: 1, read_only: true,
    measured_at: new Date().toISOString(), clinic_id: CLINIC,
    window_kst: '2026-05-01 ~ 2026-06-17',
    customers_in_window: customers.length,
    candidate_total: candidates.length,
    confidence_dist: byConf,
    batch_minutes: [...batchMinutes],
    related_ticket_map: { CHARTTEST: chartTest.length, RESV_0612: resv0612.length, POLLUTION_checkins: pollCI?.length ?? 0, POLLUTION_overlap: overlapPoll.length },
    customer_ref_counts: refCounts,
    checkin_child_counts: childCounts,
    candidate_checkins: candCI.length,
    daily_closings: dc ?? [],
    real_patient_guard: realHits.map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
    candidates: ordered.map((c) => ({ id: c.id, name: c.name, phone: c.phone, visit_type: c.visit_type, is_simulation: c.is_simulation, created_at: c.created_at, memo: c.memo, markers: c.markers, conf: c.conf, related: c.related ?? [] })),
  };
  const path = 'db-gate/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage1_inventory.json';
  writeFileSync(path, JSON.stringify(evidence, null, 2));
  console.log(`\n📄 evidence 저장: ${path}`);
  console.log(`\n===SUMMARY=== 윈도고객 ${customers.length} / 더미후보 ${candidates.length} (HIGH ${byConf.HIGH ?? 0}·MED ${byConf.MED ?? 0}·LOW ${byConf.LOW ?? 0}) / 실환자가드 ${realHits.length} / 후보check_ins ${candCI.length}`);
}
main().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
