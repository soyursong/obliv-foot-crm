/**
 * T-20260701-foot-STAFF-ROSTER-DEDUP — #6 정혜인 RECONCILE DRY-RUN (READ-ONLY, prod write 0)
 *
 * 목적(planner reconcile 게이트): 구 티켓 T-20260619-STAFF-DELETE-JEONGHYEIN(hard-delete, SUPERSEDED)
 *   과 ROSTER-DEDUP dryrun 간 factual 불일치 3건을 fresh 재확인한다.
 *
 *   [불일치1] 정혜인 staff row 수 + active state
 *       - T-20260619 FK precheck(6/19): 정혜인 1행뿐, active=false, id=5f141f76, clinic 74967aea, 동명이인 0
 *       - ROSTER-DEDUP DA 계획: "active 정혜인 canonical행 실재" 전제
 *       → staff WHERE name='정혜인' 전수 재조회로 확정.
 *   [불일치2] 전체 FK 귀속 재집계
 *       - ROSTER-DEDUP = 2건 (room_assignments.staff_id 만) — 부모 스크립트 SCAN_TABLES 에
 *         base `customers` 테이블 누락 → customers.assigned_staff_id 미집계였음(RC).
 *       - T-20260619 = 3건 (room_assignments 2 + customers.assigned_staff_id 설연우 1)
 *       → 4개 FK 컬럼 동적 재집계: duty_roster.doctor_id / package_sessions.performed_by
 *         / room_assignments.staff_id / customers.assigned_staff_id.
 *   [불일치3] 재귀속 대상 확정
 *       - active canonical 정혜인 실재 시 → 그 행
 *       - 부재(동명이인0) 시 → 정연주(joo4442@naver.com, clinic 74967aea, consultant)
 *       → 정연주 staff/user_profiles 실재·active·clinic 확인.
 *
 * 안전(§3.1 면제 아님 — PHI 귀속 경로):
 *   - 오직 SELECT / head-count (service_role REST). UPDATE/INSERT/DELETE/soft-delete 호출 **없음**. prod write 0.
 *   - PHI 최소화: customers 매치는 id + assigned_staff_id + created_at + phone 끝4자리만(reconcile 근거).
 *     성명/전체 전화번호 원문 dump 안 함.
 *   - canonical 판정·처분은 본 스크립트가 하지 않음. planner reconcile → supervisor DB 게이트 後 별도 apply.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

function envFromLocal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].trim();
    }
  }
  return null;
}
const URL = envFromLocal('VITE_SUPABASE_URL');
const SRK = envFromLocal('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !SRK) { console.error('❌ missing URL/SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(URL, SRK, { auth: { persistSession: false } });
const log = (...a) => console.log(...a);

const KNOWN_DUP_ID = '5f141f76-7f72-4560-8a67-bbcdf4938cad'; // T-20260619 보고 정혜인 id
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const JEONGYEONJU_EMAIL = 'joo4442@naver.com'; // fallback 재귀속 대상 정연주

// reconcile 대상 4개 FK (table.column). 미존재 시 skip.
const FK_COLS = [
  { table: 'duty_roster', column: 'doctor_id' },
  { table: 'package_sessions', column: 'performed_by' },
  { table: 'room_assignments', column: 'staff_id' },
  { table: 'customers', column: 'assigned_staff_id' }, // ← 부모 스크립트가 누락했던 경로
];

async function headCount(table, col, id) {
  const { count, error } = await db.from(table).select(col, { count: 'exact', head: true }).eq(col, id);
  if (error) return { skip: true, reason: error.code || error.message };
  return { count: count ?? 0 };
}

async function main() {
  const out = {
    ticket: 'T-20260701-foot-STAFF-ROSTER-DEDUP',
    scope: '#6 정혜인 reconcile (READ-ONLY)',
    generated_at: new Date().toISOString(),
    mode: 'READ-ONLY dry-run (prod write 0)',
    mismatch1_row_state: {},
    mismatch2_fk_retally: {},
    mismatch3_reattribution_target: {},
    conclusion: {},
  };

  // ── [불일치1] 정혜인 staff 전수 재조회 (name='정혜인') ──
  log('── [불일치1] staff WHERE name=정혜인 전수 재조회 ──');
  const { data: jhRows, error: jhErr } = await db.from('staff')
    .select('id, user_id, role, name, clinic_id, active, created_at, updated_at')
    .eq('name', '정혜인');
  if (jhErr) { console.error('staff 조회 실패', jhErr.message); process.exit(1); }
  const activeJh = (jhRows || []).filter(r => r.active === true);
  out.mismatch1_row_state = {
    total_rows: (jhRows || []).length,
    active_rows: activeJh.length,
    inactive_rows: (jhRows || []).filter(r => r.active === false).length,
    known_dup_id_present: (jhRows || []).some(r => r.id === KNOWN_DUP_ID),
    rows: (jhRows || []).map(r => ({
      id: r.id, active: r.active, role: r.role, clinic_id: r.clinic_id,
      user_id: r.user_id, created_at: r.created_at,
      is_known_dup: r.id === KNOWN_DUP_ID,
    })),
    verdict: activeJh.length > 0
      ? `ACTIVE_CANONICAL_EXISTS — 활성 정혜인 ${activeJh.length}행 실재 (ROSTER-DEDUP DA 전제 성립)`
      : `NO_ACTIVE_CANONICAL — 활성 정혜인 0행, 전부 비활성 (T-20260619 "동명이인0" 보고와 일치)`,
  };
  for (const r of (jhRows || [])) {
    log(`   • id=${r.id.slice(0,8)} active=${r.active} role=${r.role} clinic=${r.clinic_id === CLINIC ? 'OK' : r.clinic_id} user_id=${r.user_id || 'null'}${r.id === KNOWN_DUP_ID ? '  [T-20260619 보고행]' : ''}`);
  }
  log(`   ⇒ ${out.mismatch1_row_state.verdict}`);

  // 처분(soft-delete) 대상 확정: 알려진 dup id 존재 시 그 id. 없으면 유일 비활성행.
  let softDeleteTargetId = (jhRows || []).some(r => r.id === KNOWN_DUP_ID)
    ? KNOWN_DUP_ID
    : ((jhRows || []).filter(r => r.active === false).map(r => r.id)[0] || null);

  // ── [불일치2] 4개 FK 재집계 (soft-delete 대상 id 기준) ──
  log('\n── [불일치2] FK 귀속 재집계 (대상 staff.id = ' + (softDeleteTargetId ? softDeleteTargetId.slice(0,8) : 'null') + ') ──');
  const fkResults = [];
  let fkTotal = 0;
  if (softDeleteTargetId) {
    for (const fk of FK_COLS) {
      const r = await headCount(fk.table, fk.column, softDeleteTargetId);
      if (r.skip) { fkResults.push({ ...fk, refs: null, skip: true, reason: r.reason }); log(`   - ${fk.table}.${fk.column} → SKIP (${r.reason})`); continue; }
      fkResults.push({ ...fk, refs: r.count });
      fkTotal += r.count;
      log(`   ${r.count > 0 ? '⚠' : ' '} ${fk.table}.${fk.column} → ${r.count}건`);
    }
  }
  // customers 매치 상세 (설연우 reconcile) — PHI 최소: id + created_at + phone 끝4자리
  let custDetail = [];
  if (softDeleteTargetId) {
    const { data: custs, error: cErr } = await db.from('customers')
      .select('id, assigned_staff_id, phone, created_at, clinic_id')
      .eq('assigned_staff_id', softDeleteTargetId);
    if (!cErr) {
      custDetail = (custs || []).map(c => ({
        customer_id: c.id,
        clinic_id: c.clinic_id,
        phone_last4: typeof c.phone === 'string' ? c.phone.replace(/\D/g, '').slice(-4) : null,
        created_at: c.created_at,
      }));
      for (const c of custDetail) log(`     └ customers.assigned_staff_id 매치: cust=${c.customer_id.slice(0,8)} phone*${c.phone_last4} created=${c.created_at?.slice(0,10)}`);
    } else {
      log(`     └ customers 상세 조회 SKIP (${cErr.code || cErr.message})`);
    }
  }
  out.mismatch2_fk_retally = {
    target_staff_id: softDeleteTargetId,
    fk_columns: fkResults,
    fk_total_refs: fkTotal,
    customers_match_detail: custDetail,
    rc_of_discrepancy: '부모 ROSTER-DEDUP SCAN_TABLES 에 base customers 테이블 누락 → customers.assigned_staff_id 미집계(2건 보고). 본 재집계는 4개 FK 전수.',
    reconcile_vs_prior: {
      roster_dedup_reported: 2,
      t20260619_reported: 3,
      fresh_recount: fkTotal,
    },
  };
  log(`   ⇒ FK 총 ${fkTotal}건 (ROSTER-DEDUP 2 / T-20260619 3 대비 재확정)`);

  // ── [불일치3] 재귀속 대상 확정 ──
  log('\n── [불일치3] 재귀속 대상 확정 ──');
  let reattr = { rule: null, target: null, ambiguous: false, note: null };
  if (activeJh.length === 1) {
    const c = activeJh[0];
    reattr = { rule: 'ACTIVE_CANONICAL_JEONGHYEIN', target: { staff_id: c.id, name: c.name, role: c.role, active: c.active, clinic_id: c.clinic_id }, ambiguous: false, note: '활성 정혜인 canonical 행으로 재귀속' };
  } else if (activeJh.length > 1) {
    reattr = { rule: 'MULTIPLE_ACTIVE_JEONGHYEIN', target: null, ambiguous: true, note: `활성 정혜인 ${activeJh.length}행 — 재귀속 canonical 모호. 김주연 재confirm 필요` };
  } else {
    // 활성 정혜인 부재 → 정연주 fallback 확인
    const { data: jyjUp } = await db.from('user_profiles')
      .select('id, name, role, is_active, status, approved, clinic_id, email')
      .eq('email', JEONGYEONJU_EMAIL);
    const upRow = (jyjUp || [])[0] || null;
    let jyjStaff = [];
    if (upRow) {
      const { data: st } = await db.from('staff')
        .select('id, name, role, active, clinic_id, user_id')
        .eq('user_id', upRow.id);
      jyjStaff = st || [];
    }
    // 이름 기준 보조 조회 (user_id 링크 없을 수 있음)
    const { data: jyjByName } = await db.from('staff')
      .select('id, name, role, active, clinic_id, user_id')
      .eq('name', '정연주');
    const activeJyjStaff = (jyjByName || []).filter(s => s.active === true && s.clinic_id === CLINIC);
    reattr = {
      rule: 'FALLBACK_JEONGYEONJU',
      user_profile: upRow ? { id: upRow.id, role: upRow.role, is_active: upRow.is_active, status: upRow.status, approved: upRow.approved, clinic_id: upRow.clinic_id } : null,
      staff_by_email_link: jyjStaff.map(s => ({ staff_id: s.id, active: s.active, role: s.role, clinic_id: s.clinic_id })),
      staff_by_name: (jyjByName || []).map(s => ({ staff_id: s.id, active: s.active, role: s.role, clinic_id: s.clinic_id, user_id: s.user_id })),
      target: activeJyjStaff.length === 1
        ? { staff_id: activeJyjStaff[0].id, name: '정연주', role: activeJyjStaff[0].role, active: true, clinic_id: activeJyjStaff[0].clinic_id }
        : null,
      ambiguous: activeJyjStaff.length !== 1,
      note: activeJyjStaff.length === 1
        ? '활성 정혜인 부재 → 정연주 활성 staff 1행 확정, 재귀속 대상'
        : `정연주 활성 staff ${activeJyjStaff.length}행 (clinic ${CLINIC}) — 재귀속 대상 확정 불가, 김주연 재confirm 필요`,
    };
  }
  out.mismatch3_reattribution_target = reattr;
  log(`   rule=${reattr.rule} ambiguous=${reattr.ambiguous}`);
  log(`   target=${reattr.target ? reattr.target.staff_id.slice(0,8) + ' (' + reattr.target.name + ')' : '미확정'}`);
  log(`   note: ${reattr.note}`);

  // ── 결론 ──
  out.conclusion = {
    soft_delete_target_staff_id: softDeleteTargetId,
    soft_delete_method: 'soft-delete (active=false / deleted_at set) — hard-DELETE 금지 (의료법 §22 감사 trail, DA CONSULT MSG-20260701-212011-06ip)',
    expected_reattribution_rows: fkTotal,
    reattribution_target_staff_id: reattr.target ? reattr.target.staff_id : null,
    reattribution_ambiguous: reattr.ambiguous,
    prod_writes: 0,
    ready_for_supervisor_gate: (!!softDeleteTargetId && !reattr.ambiguous),
    blocker: reattr.ambiguous ? '재귀속 대상 모호 — planner → responder 경유 김주연 재confirm 필요' : null,
  };
  log('\n── 결론 ──');
  log('  ' + JSON.stringify(out.conclusion, null, 2).replace(/\n/g, '\n  '));

  const outPath = 'scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_jeonghyein_reconcile.out.json';
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  log(`\n✅ 정혜인 RECONCILE DRY-RUN 완료 (prod write 0). 산출: ${outPath}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
