/**
 * T-20260701-foot-STAFF-ROSTER-DEDUP — AC-1 DRY-RUN (READ-ONLY, prod write 0)
 *
 * carve-out from T-20260630-foot-STAFF-AUTH-LINK-BACKFILL.
 * 대상 6건 = 활성 staff 가 이미 user_profiles 를 점유한 상태의 "비활성 중복행".
 *   HOLD_OCCUPIED 4 (박소예·장예지·김지혜·서은정) + 비활성 HOLD_NAME_ONLY 2 (김민경·정혜인).
 *
 * 목적(AC-1): 6건 각각의 (a) 현재 상태(active/비활성·role·clinic·user_id),
 *   (b) point 중인 candidate user_profiles + 그 profile 을 현재 점유한 canonical staff,
 *   (c) 중복 사유, (d) **stale grant 스캔** — 6개 duplicate staff.id 가 PHI/귀속 경로에
 *   inbound 참조되는지(있으면 처분 전 재귀속 필요) 를 read-only 로 분류·dry-run 보고.
 *
 * 안전(§3.1 면제 아님 — PHI 귀속 경로):
 *  - 오직 SELECT / head-count (service_role REST). UPDATE/INSERT/DELETE 호출 **없음**. prod write 0.
 *  - canonical 판정·처분(비활성 마킹/soft-delete/병합)은 본 스크립트가 하지 않음.
 *    → DA CONSULT-REPLY GO → 김주연 총괄 행별 confirm → supervisor DB 게이트 後 별도 apply.
 *  - **추정 병합 금지**: 본 스크립트는 canonical/폐기 를 결정하지 않고 "판정 필요 후보"만 제시.
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

// ── 대상 6건 (부모 티켓 dryrun.out.json carve-out 확정) ──
// staff_id → { name, expected_class, candidate_up }
const TARGETS = [
  { staff_id: '5c17e4bc-e948-4dc4-a8cf-37904873edeb', name: '박소예', role: 'therapist',   class: 'HOLD_OCCUPIED',  candidate_up: '833c7135-7e26-4743-9679-a95c31573c7f' },
  { staff_id: 'a8ffcea8-bbfc-46e7-841b-8192d1d8a3cd', name: '장예지', role: 'coordinator', class: 'HOLD_OCCUPIED',  candidate_up: 'ea24c289-1e64-4878-8aae-bf8e463ea130' },
  { staff_id: '5f741eba-7397-46ac-979b-11c31fc72eb4', name: '김지혜', role: 'coordinator', class: 'HOLD_OCCUPIED',  candidate_up: 'f953b4f4-c28a-4ba9-90b7-1542f73c3f91' },
  { staff_id: '42ca1057-06c8-4183-91ab-b9ab5a7c3a26', name: '서은정', role: 'therapist',   class: 'HOLD_OCCUPIED',  candidate_up: 'f972cf34-8eb6-4898-947f-85d8c295181f' },
  { staff_id: '3d881cff-40e1-4a1a-9310-5f1482cdd1b8', name: '김민경', role: 'coordinator', class: 'HOLD_NAME_ONLY',  candidate_up: '77ef3500-f0c1-43de-9c3b-1072b7a2713c' },
  { staff_id: '5f141f76-7f72-4560-8a67-bbcdf4938cad', name: '정혜인', role: 'consultant',  class: 'HOLD_NAME_ONLY',  candidate_up: 'cbab05d7-1883-4afb-957a-bb6da1d69486' },
];
const TARGET_IDS = TARGETS.map(t => t.staff_id);
const CANDIDATE_UP_IDS = TARGETS.map(t => t.candidate_up);

// ── stale-grant 스캔 대상: (table × staff-귀속 컬럼) 후보. 존재하지 않으면 skip. ──
const ATTR_COLS = [
  'staff_id', 'therapist_id', 'consultant_id', 'doctor_id', 'coordinator_id',
  'counselor_id', 'assigned_staff_id', 'performed_by', 'treated_by', 'created_by',
  'updated_by', 'registrar_id', 'signer_staff_id', 'signed_by', 'author_staff_id',
  'requested_by', 'confirmed_by', 'checked_in_by', 'assigned_to',
];
// PHI/귀속 성격 테이블 (전수 스캔). 미존재 테이블/컬럼은 자동 skip.
const SCAN_TABLES = [
  'assignment_actions', 'chart_doctor_memos', 'chart_treatment_requests', 'check_in_room_logs',
  'check_in_services', 'check_ins', 'checklists', 'claim_diagnoses', 'claim_items',
  'clinical_images', 'clinic_memos', 'closing_manual_payments', 'consent_forms',
  'customer_consult_memos', 'customer_reservation_memos', 'customer_special_notes',
  'customer_treatment_memos', 'daily_closings', 'daily_room_status', 'duty_roster',
  'edi_submissions', 'form_submissions', 'handover_notes', 'health_q_results',
  'insurance_claims', 'insurance_documents', 'insurance_receipts', 'medical_charts',
  'medical_chart_signer_audit', 'message_logs', 'notification_logs', 'notifications',
  'opinion_documents', 'package_payments', 'package_progress_plans', 'package_sessions',
  'packages', 'patient_file_records', 'patient_past_history', 'patient_room_daily_log',
  'payment_audit_logs', 'payments', 'phi_access_log', 'prescriptions',
  'reservation_logs', 'reservation_memo_history', 'reservation_registrars', 'reservations',
  'room_assignments', 'scheduled_messages', 'service_charges', 'staff_attendance',
  'staff_temp_off', 'status_transitions', 'timer_records', 'treatment_sets', 'waiting_board',
];

async function headCount(table, col, ids) {
  // returns { count } or { skip:true } if table/col missing
  const { count, error } = await db
    .from(table).select(col, { count: 'exact', head: true }).in(col, ids);
  if (error) {
    // 42703 undefined column / 42P01 undefined table → skip
    return { skip: true, reason: error.code || error.message };
  }
  return { count: count ?? 0 };
}

async function main() {
  const out = {
    ticket: 'T-20260701-foot-STAFF-ROSTER-DEDUP',
    generated_at: new Date().toISOString(),
    mode: 'READ-ONLY dry-run (prod write 0)',
    targets: [], stale_grant_scan: { by_staff_id: [], by_candidate_up: [] },
    summary: {},
  };

  // ── [1] 대상 6 staff 현재 상태 ──
  const { data: staffRows, error: sErr } = await db.from('staff')
    .select('id, user_id, role, name, clinic_id, active, created_at, updated_at')
    .in('id', TARGET_IDS);
  if (sErr) { console.error('staff 조회 실패', sErr.message); process.exit(1); }
  const byId = Object.fromEntries((staffRows || []).map(r => [r.id, r]));
  log(`── [1] 대상 staff ${staffRows.length}/6 조회 ──`);

  // ── [2] candidate user_profiles + 현재 점유 canonical staff ──
  const { data: ups } = await db.from('user_profiles')
    .select('id, role, name, clinic_id, is_active, status, approved, created_at')
    .in('id', CANDIDATE_UP_IDS);
  const upById = Object.fromEntries((ups || []).map(r => [r.id, r]));
  // 각 candidate up 을 현재 물고 있는 staff (canonical 후보)
  const { data: occupants } = await db.from('staff')
    .select('id, user_id, role, name, clinic_id, active')
    .in('user_id', CANDIDATE_UP_IDS);
  const occByUp = {};
  for (const o of occupants || []) (occByUp[o.user_id] ??= []).push(o);

  // ── [3] stale-grant 스캔: 6 duplicate staff.id 참조 (있으면 처분 전 재귀속 대상) ──
  log('── [3] stale-grant 스캔 (staff.id inbound 참조) ──');
  for (const table of SCAN_TABLES) {
    for (const col of ATTR_COLS) {
      const r = await headCount(table, col, TARGET_IDS);
      if (r.skip) continue;
      if (r.count > 0) {
        out.stale_grant_scan.by_staff_id.push({ table, column: col, refs: r.count });
        log(`  ⚠ ${table}.${col} → ${r.count}건 (duplicate staff.id 참조)`);
      }
    }
  }
  // 참고: candidate user_profiles.id 참조 (canonical 신원 활성 사용 여부 컨텍스트)
  for (const table of SCAN_TABLES) {
    for (const col of ATTR_COLS) {
      const r = await headCount(table, col, CANDIDATE_UP_IDS);
      if (r.skip) continue;
      if (r.count > 0) out.stale_grant_scan.by_candidate_up.push({ table, column: col, refs: r.count });
    }
  }

  // 세부 참조(어느 staff_id 가 몇 건인지) — nonzero 테이블만 재조회
  const perTargetRefs = Object.fromEntries(TARGET_IDS.map(id => [id, []]));
  for (const hit of out.stale_grant_scan.by_staff_id) {
    for (const id of TARGET_IDS) {
      const { count } = await db.from(hit.table)
        .select(hit.column, { count: 'exact', head: true }).eq(hit.column, id);
      if (count > 0) perTargetRefs[id].push({ table: hit.table, column: hit.column, refs: count });
    }
  }

  // ── [4] 대상별 종합 분류 ──
  log('\n── [4] 대상별 분류 ──');
  for (const t of TARGETS) {
    const s = byId[t.staff_id] || null;
    const up = upById[t.candidate_up] || null;
    const occ = occByUp[t.candidate_up] || [];
    const staleRefs = perTargetRefs[t.staff_id] || [];
    const staleTotal = staleRefs.reduce((a, r) => a + r.refs, 0);
    const row = {
      staff_id: t.staff_id, name: t.name, expected_class: t.class,
      staff_present: !!s,
      staff_state: s ? { active: s.active, role: s.role, clinic_id: s.clinic_id, user_id: s.user_id } : null,
      candidate_up: t.candidate_up,
      candidate_up_state: up ? { role: up.role, name: up.name, is_active: up.is_active, status: up.status, approved: up.approved, clinic_id: up.clinic_id } : null,
      candidate_up_occupied_by: occ.map(o => ({ staff_id: o.id, name: o.name, role: o.role, active: o.active })),
      dup_reason: null,
      stale_grant_refs: staleRefs, stale_grant_total: staleTotal,
      disposition: 'PENDING_FIELD_CONFIRM',  // 추정 병합 금지 — 현장 확인 전까지 보류
    };
    // 중복 사유
    if (occ.length > 0) {
      row.dup_reason = `candidate user_profiles(${t.candidate_up}) 이 이미 canonical staff [${occ.map(o => `${o.name}${o.active === false ? '(비활성)' : ''}`).join(', ')}] 에 점유됨 → 본 행은 미링크 중복 로스터 행`;
    } else {
      row.dup_reason = `candidate user_profiles 미점유이나 이름 단독일치(이메일 교차검증 불가) — canonical 여부 현장 확인 필요`;
    }
    // 안전 신호
    row.safety = {
      staff_active: s ? s.active : null,
      // active 인데 stale 참조 다수 → 함부로 처분 시 활성 신원 손상 위험
      caution: (s && s.active && staleTotal > 0)
        ? 'ACTIVE_WITH_REFS — 활성 로스터 행 + 귀속 참조 존재. canonical 일 수 있음. 처분 절대 보류, 현장 확인 필수'
        : (staleTotal > 0
            ? 'INACTIVE_WITH_REFS — 비활성 중복행에 귀속 참조 잔존(stale grant). 처분 전 canonical 로 재귀속 필요'
            : 'NO_REFS — inbound 귀속 참조 0 (stale grant 없음). 처분 시 orphan 위험 낮음'),
    };
    out.targets.push(row);
    log(`  • ${t.name} [${t.class}] active=${row.staff_state?.active} up점유=${occ.length ? occ.map(o=>o.name).join('/') : '없음'} staleRefs=${staleTotal} → ${row.safety.caution.split(' —')[0]}`);
  }

  out.summary = {
    targets_present: out.targets.filter(r => r.staff_present).length,
    targets_missing: 6 - out.targets.filter(r => r.staff_present).length,
    with_stale_grant: out.targets.filter(r => r.stale_grant_total > 0).length,
    zero_ref_safe_dispose_candidates: out.targets.filter(r => r.stale_grant_total === 0).length,
    active_rows: out.targets.filter(r => r.staff_state?.active === true).length,
    inactive_rows: out.targets.filter(r => r.staff_state?.active === false).length,
    all_disposition: 'PENDING (추정 병합 금지 — DA CONSULT GO + 김주연 총괄 행별 confirm + supervisor DB 게이트 前 처분 0)',
    prod_writes: 0,
  };
  log('\n── [5] 요약 ──');
  log('  ' + JSON.stringify(out.summary, null, 2).replace(/\n/g, '\n  '));

  const outPath = 'scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_dryrun.out.json';
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  log(`\n✅ AC-1 DRY-RUN 완료 (prod write 0). 산출: ${outPath}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
