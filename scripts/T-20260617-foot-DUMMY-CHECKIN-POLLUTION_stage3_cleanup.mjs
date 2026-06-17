/**
 * T-20260617-foot-DUMMY-CHECKIN-POLLUTION — Stage 3 오염 check_ins 정리 (GATED)
 *
 * ⚠ supervisor DML gate 필수. 기본 dry-run. 실삭제는 --apply 명시 + supervisor 승인 후.
 *
 * 식별 키(Stage1 diag3 로 확정, 다중 조건 수렴):
 *   clinic_id = jongno-foot(74967aea-…)
 *   AND reservation_id IS NULL          ← 진짜 현장(예약연결) 체크인 7건 제외
 *   AND status = 'registered'           ← 접수만(시술/결제 전)
 *   AND created_at ∈ [2026-06-17 10:08:00, 10:09:00) KST  ← 10:08 단일 배치(40초)
 *   AND checked_in_at::date(KST) = 2026-06-17
 *
 * 안전장치:
 *   1) 후보 재조회 → 개수 검증(예상 30, 35 초과 시 ABORT)
 *   2) reservation_id 연결 행이 한 건이라도 잡히면 ABORT(현장 체크인 보호)
 *   3) 자식 FK 행(비-CASCADE) 존재 시 ABORT(요청 전 재게이트)
 *   4) 삭제 전 대상행 + 자식행 + 연결 customers 를 백업 JSON 으로 보존
 *   5) --apply 없으면 어떤 write 도 안 함(순수 dry-run)
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

// 비-CASCADE check_ins 자식(check_in_id FK): 행 있으면 ABORT.
// (medical_charts 는 check_in_id FK 가 아니라 customer_id+clinic_id+visit_date 로 연결 → 제외)
const CHILD_TABLES_BLOCKING = [
  'package_sessions', 'payments', 'consent_forms', 'checklists',
  'insurance_documents', 'notifications',
];
const CHILD_TABLES_CASCADE = ['check_in_services', 'status_transitions']; // 참고용(자동삭제)

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
  console.log(`후보 ${ids.length}건`);

  // 2) 개수 sanity
  if (ids.length === 0) { console.log('대상 0건 — 종료(이미 정리됨?).'); return; }
  if (ids.length > 35) throw new Error(`ABORT: 후보 ${ids.length}건 > 35 예상초과. 키 재검토 필요.`);

  // 2-b) reservation_id 연결 행 방어(이미 WHERE 로 NULL 한정했지만 이중확인)
  const linked = (cand ?? []).filter((c) => c.reservation_id);
  if (linked.length) throw new Error(`ABORT: reservation 연결 행 ${linked.length}건 포함 — 현장 체크인 위험.`);

  // 3) 자식행 카운트
  console.log(`\n── 자식 FK 행 카운트 ──`);
  const childCounts = {};
  for (const t of [...CHILD_TABLES_BLOCKING, ...CHILD_TABLES_CASCADE]) {
    let total = 0;
    try {
      for (let i = 0; i < ids.length; i += 100) {
        const { count, error: ce } = await sb.from(t)
          .select('id', { count: 'exact', head: true })
          .in('check_in_id', ids.slice(i, i + 100));
        if (ce) { total = `ERR:${ce.message.slice(0, 40)}`; break; }
        total += count ?? 0;
      }
    } catch (e) { total = `ERR:${e.message.slice(0, 40)}`; }
    childCounts[t] = total;
    console.log(`  ${t}: ${total}`);
  }
  const blocking = CHILD_TABLES_BLOCKING.filter((t) => typeof childCounts[t] === 'number' && childCounts[t] > 0);
  if (blocking.length) {
    console.log(`\n⚠ 비-CASCADE 자식행 존재: ${blocking.join(', ')} → DELETE 차단. planner 재게이트 필요.`);
  }

  // 4) 백업 (연결 customers 포함)
  const cids = [...new Set((cand ?? []).map((c) => c.customer_id).filter(Boolean))];
  const { data: custs } = await sb.from('customers')
    .select('id, name, phone, visit_type, is_simulation, created_at').in('id', cids);
  const stamp = '20260617';
  mkdirSync('rollback', { recursive: true });
  const backup = {
    ticket: 'T-20260617-foot-DUMMY-CHECKIN-POLLUTION', stage: 3,
    backed_up_at: new Date().toISOString(),
    where_key: "reservation_id IS NULL AND status='registered' AND created_at∈[10:08:00,10:09:00)KST AND checked_in_at::date=2026-06-17",
    check_ins: cand, customers: custs, child_counts: childCounts,
  };
  const path = `rollback/T-20260617-foot-DUMMY-CHECKIN-POLLUTION_stage3_backup.json`;
  writeFileSync(path, JSON.stringify(backup, null, 2));
  console.log(`\n백업 저장: ${path} (check_ins ${cand.length} / customers ${custs?.length ?? 0})`);

  if (!APPLY) {
    console.log(`\n[DRY-RUN] 삭제 안 함. 실삭제: --apply (supervisor 승인 후). 대상 ${ids.length}건.`);
    console.log(`SQL 동치:\nDELETE FROM check_ins\n WHERE clinic_id='${CLINIC}'\n   AND reservation_id IS NULL AND status='registered'\n   AND created_at >= '${CREATED_FROM}' AND created_at < '${CREATED_TO}'\n   AND checked_in_at >= '${CHKIN_FROM}' AND checked_in_at < '${CHKIN_TO}';  -- ${ids.length} rows`);
    return;
  }

  // 5) APPLY (supervisor 게이트 통과 가정)
  if (blocking.length) throw new Error(`ABORT(apply): 비-CASCADE 자식행 ${blocking.join(',')} 존재. 재게이트 필요.`);
  const { data: del, error: de } = await sb.from('check_ins').delete().in('id', ids).select('id');
  if (de) throw new Error(`DELETE 실패: ${de.message}`);
  console.log(`\n✅ DELETE 완료: ${del?.length ?? 0}건. 백업=${path}`);

  // 사후검증
  const { count: remain } = await sb.from('check_ins').select('id', { count: 'exact', head: true })
    .eq('clinic_id', CLINIC).is('reservation_id', null).eq('status', 'registered')
    .gte('created_at', CREATED_FROM).lt('created_at', CREATED_TO);
  console.log(`[검증] 잔존 후보 ${remain}건 (0 이어야 정상).`);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
