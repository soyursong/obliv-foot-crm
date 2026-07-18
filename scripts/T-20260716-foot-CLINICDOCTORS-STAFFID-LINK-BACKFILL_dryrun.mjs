/**
 * T-20260716-foot-CLINICDOCTORS-STAFFID-LINK-BACKFILL — DRY-RUN (READ-ONLY, prod write 0)
 *
 * 목적: foot clinic_doctors 중 staff_id 미연결(NULL) 행을 전수 추출하고, 각 원장 name 기준
 *       staff(근무자 명부) 신원과 1:1 매칭 후보를 산출. 연결되면 duty_roster.doctor_id 조인이
 *       성립(clinic_doctors.staff_id = duty_roster.doctor_id, DA §2-14 canonical) → 진료콜 명단
 *       진료의(원장) 드롭다운이 근무/휴무 실시간 반영, '근무확인 미연결' advisory 해소.
 *
 * ★ 방법론 = 감독형 신원 정합(supervised identity reconciliation) — bulk 이름단독 UPDATE 아님.
 *   선례 T-20260630-foot-STAFF-AUTH-LINK-BACKFILL + DA CONSULT-REPLY(DA-20260716-foot-CLINICDOCTORS-STAFFID-LINK,
 *   MSG-20260716-005319-9e7i, GO)에서 확정. 이름일치=candidate 산출용, apply=김주연 총괄 건별
 *   현장확인 targeted 단건. 오결합(원장A row에 원장B staff_id) = duty_roster 근무/휴무 오표시 +
 *   의료신원 오염(보안속성) → 추정 매핑 절대 금지, 모호건(동명이인/무매칭/1:多/多:1) 전부 EXCLUDE.
 *
 * ★ DA 추가 narrowing(MSG-9e7i Q3) — 본 스크립트에 반영:
 *   (a) clinic_id 하드코딩 금지 → clinics.slug='jongno-foot' introspection 으로 도출.
 *       candidate 는 그 clinic_id 스코프 + 매칭 staff 도 동일 clinic 제한(cross-tenant 조인 금지).
 *   (b) candidate staff role ∈ {director, doctor} 게이트 필수(동명 coordinator 등 오매칭 차단).
 *       단 role+name = candidate 강화이지 충분조건 아님 → 현장확인(field_confirm) 여전히 필수.
 *
 * 안전:
 *  - 오직 SELECT (service_role REST). UPDATE/INSERT/DELETE 호출 없음. prod write 0.
 *  - apply 는 별도 단계(스키마 실재 사전검증(supervisor 0순위) → DA CONSULT GO(CLOSED) →
 *    김주연 총괄 건별 현장확인 → supervisor DB 백필 승인 後).
 *  - ⚠ 부모 마이그(20260708210000) prod 실적용이 divergence 의심(schema_precheck_gate). clinic_doctors.staff_id
 *    컬럼 부재 시 이 스크립트는 안전하게 abort(컬럼 실재 확정 후 재실행).
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const FOOT_SLUG = 'jongno-foot';                 // clinic_id 하드코딩 금지 — slug introspection
const DOCTOR_ROLES = ['director', 'doctor'];     // DA narrowing (b): 원장 신원 후보 게이트

// --- env ---
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
if (!URL || !SRK) { console.error('❌ missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(URL, SRK, { auth: { persistSession: false } });

const normName = (s) => (s == null ? null : String(s).replace(/\s+/g, '').toLowerCase());
const log = (...a) => console.log(...a);
const out = {
  ticket: 'T-20260716-foot-CLINICDOCTORS-STAFFID-LINK-BACKFILL',
  generated_at: new Date().toISOString(),
  foot_slug: FOOT_SLUG, foot_clinic_id: null,
  clinic_doctors_total: 0, cd_linked: 0, cd_unlinked: 0,
  rows: [], classification: {}, expected_counts: {},
};

async function tableColumns(table) {
  const { data, error } = await db.from(table).select('*').limit(1);
  if (error) return null;
  return data && data[0] ? Object.keys(data[0]) : [];
}
function pick(cols, cands) { return cands.filter(c => cols?.includes(c)); }

async function main() {
  // ── [0] foot clinic_id introspection (slug 기준, 하드코딩 금지) ──
  const { data: clinic, error: cErr } = await db.from('clinics').select('id,slug,name').eq('slug', FOOT_SLUG).single();
  if (cErr || !clinic) { console.error(`❌ clinics slug=${FOOT_SLUG} 조회 실패:`, cErr?.message); process.exit(1); }
  const FOOT_CLINIC_ID = clinic.id;
  out.foot_clinic_id = FOOT_CLINIC_ID;
  log(`── [0] foot clinic_id = ${FOOT_CLINIC_ID} (slug=${clinic.slug}, name=${clinic.name}) ──`);

  // ── [0.5] 스키마 실재 사전검증(방어): clinic_doctors.staff_id 컬럼 실재 확인 ──
  const cdCols = await tableColumns('clinic_doctors');
  if (cdCols == null) { console.error('❌ clinic_doctors 접근 불가'); process.exit(1); }
  if (!cdCols.includes('staff_id')) {
    console.error('❌ clinic_doctors.staff_id 컬럼 부재 — 부모 마이그(20260708210000) prod 미적용.');
    console.error('   → 부모 T-20260708 마이그 적용(supervisor PHI DB-GATE) 선행 후 재실행.');
    process.exit(2);
  }

  // ── [1] foot staff 로드 (role ∈ {director,doctor}, 동일 clinic — cross-tenant 금지) ──
  const stCols = await tableColumns('staff');
  if (stCols == null) { console.error('❌ staff 접근 불가'); process.exit(1); }
  const stSel = ['id', 'role', ...pick(stCols, ['name', 'clinic_id', 'active', 'is_active', 'status', 'created_at'])].join(',');
  const { data: staffAll, error: sErr } = await db.from('staff').select(stSel).eq('clinic_id', FOOT_CLINIC_ID);
  if (sErr) { console.error('staff err', sErr.message); process.exit(1); }
  const doctorStaff = staffAll.filter(s => DOCTOR_ROLES.includes(s.role));
  log(`── [1] foot staff 총 ${staffAll.length}건 — role∈{${DOCTOR_ROLES.join(',')}} 원장후보 ${doctorStaff.length}건 ──`);
  log('  role 분포:', JSON.stringify(staffAll.reduce((a, s) => ((a[s.role] = (a[s.role] || 0) + 1), a), {})));
  // 이름 인덱스 (원장 role 만)
  const staffByName = {};
  for (const s of doctorStaff) { const n = normName(s.name); if (n) (staffByName[n] ??= []).push(s); }

  // ── [2] clinic_doctors 로드 (동일 clinic) + staff_id 연결 현황 ──
  const cdSel = ['id', 'staff_id', ...pick(cdCols, ['name', 'clinic_id', 'active', 'is_default', 'license_no', 'sort_order'])].join(',');
  const { data: cds, error: dErr } = await db.from('clinic_doctors').select(cdSel).eq('clinic_id', FOOT_CLINIC_ID);
  if (dErr) { console.error('clinic_doctors err', dErr.message); process.exit(1); }
  out.clinic_doctors_total = cds.length;
  const linked = cds.filter(d => d.staff_id);
  const unlinked = cds.filter(d => !d.staff_id);
  out.cd_linked = linked.length;
  out.cd_unlinked = unlinked.length;
  log(`── [2] clinic_doctors 총 ${cds.length}건 — 연결 ${linked.length} / 미연결 ${unlinked.length} ──`);
  // 이미 점유된 staff.id (1:1 가드용)
  const usedStaffIds = new Set(linked.map(d => d.staff_id));

  // ── [3] 미연결 clinic_doctors 행별 매칭 후보 산출 (name 정확일치, 원장 role 만) ──
  log('\n── [3] 미연결 clinic_doctors → staff(원장) 매칭 후보 ──');
  const proposedCount = {};   // 多:1 탐지 (한 staff 가 복수 clinic_doctors 에 제안됨)
  for (const d of unlinked) {
    const dName = normName(d.name);
    let cand = [], basis = null, confidence = null;

    // 이름 정확일치 (원장 role 풀 안에서만, 동일 clinic)
    if (dName && staffByName[dName]) { cand = staffByName[dName].slice(); basis = `이름 정확일치 (${d.name}, role∈{${DOCTOR_ROLES.join(',')}})`; }

    const candIds = cand.map(c => c.id);
    const freeCand = cand.filter(c => !usedStaffIds.has(c.id)); // 미점유 staff 만
    let proposed = null, status = null;

    if (cand.length === 0) {
      status = 'NO_MATCH'; confidence = 'NONE';
      basis = `이름 일치 원장(role∈{${DOCTOR_ROLES.join(',')}}) staff 없음 → 현장확인/미등록 분류`;
    } else if (freeCand.length === 0) {
      status = 'HOLD_OCCUPIED'; confidence = 'NONE';
      basis += ' — 후보 staff 가 이미 타 clinic_doctors.staff_id 로 점유됨(1:1 위반) → 현장확인';
    } else if (freeCand.length === 1) {
      // 이름단독 = 후보 강화이지 충분조건 아님(DA). apply 전 현장확인 필수 → confidence MEDIUM.
      proposed = freeCand[0].id; status = 'CANDIDATE'; confidence = 'MEDIUM';
      basis += ' — 단일 후보(이름+원장role). ★현장확인 필수(추정 apply 금지)';
    } else {
      status = 'HOLD_MULTI'; confidence = 'LOW';
      basis += ` — 후보 ${freeCand.length}건(동명이인/1:多 모호) → 현장확인`;
    }
    if (proposed) proposedCount[proposed] = (proposedCount[proposed] || 0) + 1;

    out.rows.push({
      clinic_doctor_id: d.id, cd_name: d.name ?? null, cd_active: d.active ?? null,
      cd_is_default: d.is_default ?? null, cd_license_no: d.license_no ?? null,
      current_staff_id: d.staff_id ?? null,
      candidate_staff_ids: candIds,
      proposed_staff_id: proposed, status, confidence, basis,
      proposed_staff: proposed ? (() => { const s = doctorStaff.find(x => x.id === proposed);
        return s ? { id: s.id, name: s.name ?? null, role: s.role, clinic_id: s.clinic_id ?? null, active: s.active ?? s.is_active ?? null } : null; })() : null,
    });
  }

  // 多:1 사후 탐지 (한 staff 가 복수 clinic_doctors 에 제안됨) → 강등
  for (const r of out.rows) {
    if (r.proposed_staff_id && proposedCount[r.proposed_staff_id] > 1) {
      r.status = 'HOLD_MULTI_REVERSE'; r.confidence = 'LOW';
      r.basis += ` — 동일 staff 가 복수 clinic_doctors(${proposedCount[r.proposed_staff_id]}건)에 제안됨(多:1) → 현장확인`;
      r.proposed_staff_id = null;
    }
  }

  out.rows.forEach(r => log(`  • 원장="${r.cd_name || r.clinic_doctor_id}" ⇒ staff ${r.proposed_staff_id || '—'} ` +
    `[${r.status}/${r.confidence}] ${r.basis}`));

  // ── [4] 분류 (현장확인 후보 vs 보류/제외) ──
  const candidates = out.rows.filter(r => r.proposed_staff_id && r.confidence === 'MEDIUM');
  const hold = out.rows.filter(r => !r.proposed_staff_id || r.confidence !== 'MEDIUM');
  out.classification = {
    field_confirm_candidates: candidates.map(r => ({ clinic_doctor_id: r.clinic_doctor_id, cd_name: r.cd_name,
      proposed_staff_id: r.proposed_staff_id, proposed_staff_name: r.proposed_staff?.name, basis: r.basis })),
    hold_or_exclude: hold.map(r => ({ clinic_doctor_id: r.clinic_doctor_id, cd_name: r.cd_name,
      status: r.status, basis: r.basis })),
  };
  log('\n── [4] 분류 ──');
  log(`  현장확인 후보(single, 원장role, 미점유): ${candidates.length}건`);
  candidates.forEach(r => log(`    ▶ "${r.cd_name}" → staff ${r.proposed_staff_id} ("${r.proposed_staff?.name}") [현장확인 대기]`));
  log(`  보류/제외(추정 apply 금지): ${hold.length}건`);
  hold.forEach(r => log(`    ❓ "${r.cd_name}" — ${r.status}`));

  // ── [5] 기대행수 (apply 삼중가드 검증용) ──
  out.expected_counts = {
    clinic_doctors_total: out.clinic_doctors_total,
    cd_unlinked: out.cd_unlinked,
    field_confirm_candidate_rows: candidates.length,
    hold_rows: hold.length,
    candidate_clinic_doctor_ids: candidates.map(r => r.clinic_doctor_id),
  };
  log('\n── [5] 기대행수 ──');
  log('  ' + JSON.stringify(out.expected_counts));

  const outPath = 'scripts/T-20260716-foot-CLINICDOCTORS-STAFFID-LINK-BACKFILL_dryrun.out.json';
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  log(`\n✅ DRY-RUN 완료 (prod write 0). 산출: ${outPath}`);
  log('   다음 단계: candidate 목록 → 김주연 총괄 건별 현장확인 → apply.sql UUID 채움 → supervisor DB 백필 승인 → APPLY.');
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
