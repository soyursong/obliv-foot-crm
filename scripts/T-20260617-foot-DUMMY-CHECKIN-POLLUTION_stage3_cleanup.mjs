/**
 * T-20260617-foot-DUMMY-CHECKIN-POLLUTION — Stage 3 오염 정리 (GATED)
 *
 * ⚠ supervisor DML gate 필수. 기본 dry-run. 실삭제는 --apply 명시 + supervisor 승인 후.
 *
 * 범위(planner PUSH MSG-20260617-183001-nax4 보강):
 *   (A) check_ins 30건 DELETE  — 셀프접수 대기명단 미노출 + 일마감 접수목록 오염 원인
 *   (B) customers 30건 DELETE  — is_simulation=FALSE ad-hoc 오염 고객. 단 역참조 COUNT=0 재확인 후.
 *   (C) daily_closings 검증     — 6/17 일마감 스냅샷에 별도 committed 행 존재 여부 dry-run SELECT.
 *
 * 식별 키(Stage1 diag3 확정, 다중 조건 수렴):
 *   clinic_id = jongno-foot(74967aea-…)
 *   AND reservation_id IS NULL          ← 진짜 현장(예약연결) 체크인 7건 제외
 *   AND status = 'registered'           ← 접수만(시술/결제 전)
 *   AND created_at ∈ [2026-06-17 10:08:00, 10:09:00) KST  ← 10:08 단일 배치(40초)
 *   AND checked_in_at::date(KST) = 2026-06-17
 *
 * 안전장치:
 *   1) 후보 재조회 → 개수 검증(예상 30, 35 초과 시 ABORT)
 *   2) reservation_id 연결 행이 한 건이라도 잡히면 ABORT(현장 체크인 보호)
 *   3) 실환자 가드: 삭제 대상 이름에 윤민희/김진화/이시형(실체험단) 포함 시 ABORT
 *   4) check_ins 자식 FK 행(비-CASCADE) 존재 시 ABORT(요청 전 재게이트)
 *   5) customers 역참조: 30 cid 가 다른 테이블(reservations/payments/…)에 1건이라도 참조되면
 *      customers DELETE 차단(check_ins 만 정리, planner 재게이트)
 *   6) 삭제 전 대상행 + 자식행 + 연결 customers + daily_closings 스냅샷 백업
 *   7) --apply 없으면 어떤 write 도 안 함(순수 dry-run)
 *   8) APPLY 시 순서: check_ins DELETE → customers 역참조 재검(==0) → customers DELETE
 *
 * 실행:
 *   node scripts/...stage3_cleanup.mjs            # dry-run(기본) + 백업 생성
 *   node scripts/...stage3_cleanup.mjs --apply    # 실삭제(supervisor 승인 후에만)
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const sb = createClient(
  'https://rxlomoozakkjesdqjtvd.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg',
  { auth: { persistSession: false } },
);
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const APPLY = process.argv.includes('--apply');
// KST 10:08 배치 윈도 → UTC
const CREATED_FROM = '2026-06-17T01:08:00Z';   // 10:08:00 KST
const CREATED_TO   = '2026-06-17T01:09:00Z';   // 10:09:00 KST
const CHKIN_FROM   = '2026-06-16T15:00:00Z';   // 06-17 00:00 KST
const CHKIN_TO     = '2026-06-17T15:00:00Z';   // 06-18 00:00 KST

// 실환자 가드(planner 16:33 m06c): 실제 체험단 — 절대 삭제 금지.
const REAL_PATIENT_NAMES = ['윤민희', '김진화', '이시형'];

// 비-CASCADE check_ins 자식(check_in_id FK): 행 있으면 ABORT.
const CHILD_TABLES_BLOCKING = [
  'package_sessions', 'payments', 'consent_forms', 'checklists',
  'insurance_documents', 'notifications',
];
const CHILD_TABLES_CASCADE = ['check_in_services', 'status_transitions']; // 참고용(자동삭제)

// customers 역참조 테이블(customer_id FK 보유 확인분). check_ins 는 본 정리에서 삭제하므로 제외.
// 이 중 1건이라도 참조되면 customers DELETE 차단(해당 고객이 더미 외 활동 존재 = 재게이트).
// ※ 제외(live 스키마 실측 2026-06-17): customer_id 컬럼 없음 → customers 역참조 불가(=0 기여).
//    - package_sessions/payment_codes : package_id·check_in_id 경유(check_ins 삭제 시 CASCADE/무관)
//    - service_payment_codes : prod 에 customer_id 컬럼 부재(마이그 미적용/드롭, code 42703)
const CUSTOMER_REF_TABLES = [
  'reservations', 'payments', 'package_payments', 'packages',
  'medical_charts', 'consent_forms', 'checklists', 'clinical_images',
  'insurance_claims', 'insurance_documents', 'insurance_receipts',
  'form_submissions', 'health_q_results', 'health_q_tokens',
  'customer_special_notes', 'customer_treatment_memos', 'chart_doctor_memos',
  'message_logs', 'notification_logs', 'notification_opt_outs', 'scheduled_messages',
  'prescriptions', 'rx_audit_log', 'payment_code_claims', 'service_charges',
];

async function countIn(table, col, ids) {
  // 카운트 컬럼은 필터 컬럼(col) 자체 사용 — 테이블에 'id' PK 가 없을 수도 있음(예: service_payment_codes).
  let total = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { count, error } = await sb.from(table)
      .select(col, { count: 'exact', head: true })
      .in(col, ids.slice(i, i + 100));
    if (error) return `ERR:${(error.message || error.code || 'unknown').slice(0, 50)}`;
    total += count ?? 0;
  }
  return total;
}

async function main() {
  console.log(`== Stage3 정리 ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ==`);

  // 1) 후보 재조회 (정밀 WHERE)
  const { data: cand, error } = await sb
    .from('check_ins')
    .select('id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, checked_in_at, created_at, notes')
    .eq('clinic_id', CLINIC)
    .is('reservation_id', null)
    .eq('status', 'registered')
    .gte('created_at', CREATED_FROM).lt('created_at', CREATED_TO)
    .gte('checked_in_at', CHKIN_FROM).lt('checked_in_at', CHKIN_TO)
    .order('checked_in_at');
  if (error) throw new Error(`후보 조회 실패: ${error.message}`);
  const ids = (cand ?? []).map((c) => c.id);
  console.log(`check_ins 후보 ${ids.length}건`);

  // 2) 개수 sanity
  if (ids.length === 0) { console.log('대상 0건 — 종료(이미 정리됨?).'); return; }
  if (ids.length > 35) throw new Error(`ABORT: 후보 ${ids.length}건 > 35 예상초과. 키 재검토 필요.`);

  // 2-b) reservation_id 연결 행 방어
  const linked = (cand ?? []).filter((c) => c.reservation_id);
  if (linked.length) throw new Error(`ABORT: reservation 연결 행 ${linked.length}건 포함 — 현장 체크인 위험.`);

  // 2-c) 실환자 이름 가드
  const realHit = (cand ?? []).filter((c) => REAL_PATIENT_NAMES.includes((c.customer_name ?? '').trim()));
  if (realHit.length) {
    throw new Error(`ABORT: 실환자(${realHit.map((r) => r.customer_name).join(',')}) 포함 — 즉시 중단·재게이트.`);
  }
  console.log(`실환자 가드 통과(윤민희/김진화/이시형 0건 포함).`);

  // 3) check_ins 자식행 카운트
  console.log(`\n── check_ins 자식 FK 행 카운트 ──`);
  const childCounts = {};
  for (const t of [...CHILD_TABLES_BLOCKING, ...CHILD_TABLES_CASCADE]) {
    childCounts[t] = await countIn(t, 'check_in_id', ids);
    console.log(`  ${t}: ${childCounts[t]}`);
  }
  const blocking = CHILD_TABLES_BLOCKING.filter((t) => typeof childCounts[t] === 'number' && childCounts[t] > 0);
  if (blocking.length) {
    console.log(`\n⚠ 비-CASCADE 자식행 존재: ${blocking.join(', ')} → DELETE 차단. planner 재게이트 필요.`);
  }

  // 3-b) customers 역참조 카운트 (30 cid 가 다른 테이블에 묶였는지)
  const cids = [...new Set((cand ?? []).map((c) => c.customer_id).filter(Boolean))];
  console.log(`\n── customers 역참조 카운트 (cid ${cids.length}개) ──`);
  const custRefCounts = {};
  for (const t of CUSTOMER_REF_TABLES) {
    custRefCounts[t] = await countIn(t, 'customer_id', cids);
    if (custRefCounts[t] !== 0) console.log(`  ${t}: ${custRefCounts[t]}`);
  }
  const custRefNumeric = Object.entries(custRefCounts).filter(([, v]) => typeof v === 'number');
  const custRefBlocking = custRefNumeric.filter(([, v]) => v > 0).map(([t]) => t);
  const custRefTotal = custRefNumeric.reduce((s, [, v]) => s + v, 0);
  console.log(`  → 역참조 합계(숫자형): ${custRefTotal} (0 이어야 customers DELETE 안전)`);
  if (custRefBlocking.length) {
    console.log(`  ⚠ customers 역참조 존재: ${custRefBlocking.join(', ')} → customers DELETE 차단(check_ins 만 정리, 재게이트).`);
  }

  // 3-c) daily_closings 스냅샷 검증 (집계 테이블 — 개별 고객행 없음 확인용)
  const { data: dc } = await sb.from('daily_closings')
    .select('id, close_date, status, closed_at, package_card_total, package_cash_total, single_card_total, single_cash_total, actual_card_total, actual_cash_total, memo')
    .eq('clinic_id', CLINIC)
    .gte('close_date', '2026-06-15').lte('close_date', '2026-06-18')
    .order('close_date');
  console.log(`\n── daily_closings(6/15~6/18 jongno-foot) ──`);
  if (!dc || dc.length === 0) {
    console.log(`  행 0건 — 일마감 미실행. '접수 목록'은 check_ins 라이브 파생 → check_ins 30 삭제로 해소(별도 정리 불요).`);
  } else {
    for (const r of dc) {
      console.log(`  ${r.close_date} status=${r.status} closed_at=${r.closed_at ?? '-'} 단품현금=${r.single_cash_total} 실수금카드=${r.actual_card_total}`);
    }
    console.log(`  ※ daily_closings 는 clinic+close_date 집계 1행(개별 customer/check_in 행 없음). 30건(status=registered·결제0)은 금액 totals 미반영. 별도 삭제 대상 행 없음 → check_ins 삭제로 접수목록(라이브 파생) 정상화.`);
  }

  // 4) 백업 (check_ins + customers + 자식/역참조 카운트 + daily_closings)
  const { data: custs } = await sb.from('customers')
    .select('id, name, phone, visit_type, is_simulation, created_at').in('id', cids);
  mkdirSync('rollback', { recursive: true });
  const backup = {
    ticket: 'T-20260617-foot-DUMMY-CHECKIN-POLLUTION', stage: 3,
    backed_up_at: new Date().toISOString(),
    where_key: "reservation_id IS NULL AND status='registered' AND created_at∈[10:08:00,10:09:00)KST AND checked_in_at::date=2026-06-17",
    check_ins: cand, customers: custs,
    child_counts: childCounts, customer_ref_counts: custRefCounts,
    daily_closings_snapshot: dc ?? [],
  };
  const path = `rollback/T-20260617-foot-DUMMY-CHECKIN-POLLUTION_stage3_backup.json`;
  writeFileSync(path, JSON.stringify(backup, null, 2));
  console.log(`\n백업 저장: ${path} (check_ins ${cand.length} / customers ${custs?.length ?? 0})`);

  if (!APPLY) {
    console.log(`\n[DRY-RUN] 삭제 안 함. 실삭제: --apply (supervisor 승인 후).`);
    console.log(`  check_ins DELETE 대상: ${ids.length}건`);
    console.log(`  customers DELETE 대상: ${cids.length}건 (역참조 ${custRefTotal}건 → ${custRefBlocking.length ? '차단' : '안전'})`);
    return;
  }

  // ── APPLY (supervisor 게이트 통과 가정) ──
  if (blocking.length) throw new Error(`ABORT(apply): check_ins 비-CASCADE 자식행 ${blocking.join(',')} 존재. 재게이트 필요.`);

  // 5-A) check_ins DELETE
  const { data: delC, error: deC } = await sb.from('check_ins').delete().in('id', ids).select('id');
  if (deC) throw new Error(`check_ins DELETE 실패: ${deC.message}`);
  console.log(`\n✅ check_ins DELETE 완료: ${delC?.length ?? 0}건.`);

  // 5-B) customers 역참조 재검 (check_ins 삭제 후 0 이어야 함)
  let postRefTotal = 0; const postRefBlocking = [];
  for (const t of CUSTOMER_REF_TABLES) {
    const v = await countIn(t, 'customer_id', cids);
    if (typeof v === 'number' && v > 0) { postRefTotal += v; postRefBlocking.push(`${t}:${v}`); }
  }
  if (postRefBlocking.length) {
    console.log(`\n⚠ customers DELETE 건너뜀 — 역참조 잔존(${postRefBlocking.join(', ')}). check_ins 만 정리됨. planner 재게이트.`);
  } else {
    const { data: delU, error: deU } = await sb.from('customers').delete().in('id', cids).select('id');
    if (deU) throw new Error(`customers DELETE 실패: ${deU.message}`);
    console.log(`✅ customers DELETE 완료: ${delU?.length ?? 0}건.`);
  }

  // 사후검증
  const { count: remain } = await sb.from('check_ins').select('id', { count: 'exact', head: true })
    .eq('clinic_id', CLINIC).is('reservation_id', null).eq('status', 'registered')
    .gte('created_at', CREATED_FROM).lt('created_at', CREATED_TO);
  const { count: remainCust } = await sb.from('customers').select('id', { count: 'exact', head: true }).in('id', cids);
  console.log(`\n[검증] 잔존 check_ins 후보 ${remain}건 / 잔존 customers ${remainCust}건 (0/0 이어야 정상). 백업=${path}`);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
