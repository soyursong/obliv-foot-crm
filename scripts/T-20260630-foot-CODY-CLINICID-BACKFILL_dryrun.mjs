/**
 * T-20260630-foot-CODY-CLINICID-BACKFILL — DRY-RUN (READ-ONLY, prod write 0)
 *
 * 목적: clinic_id=NULL staff/coordinator 전수 추출 + 행별 증거(등록출처/활동발자국) +
 *       역할별 NULL 의미 분기 분류('누락(결함) vs 정상 다지점') + 기대행수 사전 산출.
 *
 * 안전:
 *  - 오직 SELECT (service_role REST). UPDATE/INSERT/DELETE 호출 없음.
 *  - prod write 0. apply 는 별도 단계(supervisor DB 게이트 + 김주연 사람확인 後).
 *
 * 증거 우선순위(추정0): ① 등록 출처/생성 컨텍스트 → ② 활동 발자국(check_ins/reservations/charts
 *   단일 clinic 수렴) → ③ 모호 시 현장 확인.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

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
if (!URL || !SRK) { console.error('❌ missing URL/SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(URL, SRK, { auth: { persistSession: false } });

const out = { generated_at: new Date().toISOString(), clinics: [], null_profiles: [], classification: {}, expected_counts: {} };
const log = (...a) => console.log(...a);

// 테이블별 staff-FK 후보 컬럼 (있는 것만 사용)
const FOOTPRINT_TABLES = {
  check_ins:        ['registrar_id', 'performed_by', 'created_by'],
  reservations:     ['consultant_id', 'registrar_id', 'created_by', 'updated_by', 'therapist_id'],
  medical_charts:   ['created_by', 'signing_doctor', 'performed_by'],
};

async function tableColumns(table) {
  const { data, error } = await db.from(table).select('*').limit(1);
  if (error) return null; // table absent / no access
  return data && data[0] ? Object.keys(data[0]) : [];
}

async function main() {
  // ───────────────────────────────────────────────────────────
  // [1] foot clinic 수 실측
  // ───────────────────────────────────────────────────────────
  log('── [1] foot clinic 수 실측 ──');
  const clinicCols = await tableColumns('clinics');
  const activeCol = clinicCols?.includes('is_active') ? 'is_active' : (clinicCols?.includes('active') ? 'active' : null);
  const nameCol = clinicCols?.includes('name') ? 'name' : (clinicCols?.includes('clinic_name') ? 'clinic_name' : null);
  const slugCol = clinicCols?.includes('slug') ? 'slug' : null;
  const sel = ['id', nameCol, slugCol, activeCol].filter(Boolean).join(',');
  const { data: clinics, error: cErr } = await db.from('clinics').select(sel);
  if (cErr) { console.error('clinics err', cErr.message); }
  out.clinics = clinics || [];
  const activeClinics = (clinics || []).filter(c => activeCol ? c[activeCol] !== false : true);
  log(`  clinics 총 ${clinics?.length ?? '?'}건, active ${activeClinics.length}건`);
  for (const c of clinics || []) log(`    - ${c.id}  ${nameCol ? c[nameCol] : ''} ${slugCol ? '/' + c[slugCol] : ''} ${activeCol ? '(active=' + c[activeCol] + ')' : ''}`);
  out.tenancy = activeClinics.length <= 1 ? 'SINGLE_TENANT' : 'MULTI_CLINIC';
  out.sole_clinic_id = activeClinics.length === 1 ? activeClinics[0].id : null;
  log(`  ⇒ 테넌시 판정: ${out.tenancy}${out.sole_clinic_id ? '  유일 clinic=' + out.sole_clinic_id : ''}\n`);

  // ───────────────────────────────────────────────────────────
  // [2] clinic_id=NULL staff/coordinator 전수 추출
  // ───────────────────────────────────────────────────────────
  log('── [2] clinic_id IS NULL user_profiles 전수 ──');
  const upCols = await tableColumns('user_profiles');
  const upSelParts = ['id', 'role', 'clinic_id',
    upCols.includes('email') ? 'email' : null,
    upCols.includes('name') ? 'name' : null,
    upCols.includes('is_active') ? 'is_active' : null,
    upCols.includes('status') ? 'status' : null,
    upCols.includes('approved') ? 'approved' : null,
    upCols.includes('created_at') ? 'created_at' : null,
    upCols.includes('created_via') ? 'created_via' : null,
    upCols.includes('has_ops_authority') ? 'has_ops_authority' : null,
    upCols.includes('exempt_from_restrictions') ? 'exempt_from_restrictions' : null,
  ].filter(Boolean);
  const { data: nullProfiles, error: nErr } = await db
    .from('user_profiles').select(upSelParts.join(','))
    .is('clinic_id', null);
  if (nErr) { console.error('user_profiles err', nErr.message); process.exit(1); }
  log(`  clinic_id=NULL user_profiles: ${nullProfiles.length}건`);

  // auth.users email 보강 (user_profiles 에 email 없을 수 있음)
  let authEmail = {};
  try {
    const { data: au } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of au?.users || []) authEmail[u.id] = u.email;
  } catch (e) { log('  (auth email 보강 skip:', e.message, ')'); }

  // ───────────────────────────────────────────────────────────
  // [3] 행별 활동 발자국 — clinic 수렴 분석
  // ───────────────────────────────────────────────────────────
  log('\n── [3] 행별 활동 발자국 (단일 clinic 수렴 분석) ──');
  // 실제 존재 컬럼 확정
  const tableActiveCols = {};
  for (const [t, cands] of Object.entries(FOOTPRINT_TABLES)) {
    const cols = await tableColumns(t);
    if (cols == null) { tableActiveCols[t] = null; continue; }
    tableActiveCols[t] = { has_clinic: cols.includes('clinic_id'), fks: cands.filter(c => cols.includes(c)) };
  }
  log('  발자국 테이블 컬럼:', JSON.stringify(tableActiveCols));

  async function footprint(uid) {
    const tally = {}; // clinic_id -> count
    const detail = {};
    for (const [t, info] of Object.entries(tableActiveCols)) {
      if (!info || !info.has_clinic || info.fks.length === 0) continue;
      for (const fk of info.fks) {
        const { data, error } = await db.from(t).select('clinic_id').eq(fk, uid).not('clinic_id', 'is', null).limit(2000);
        if (error) continue;
        for (const r of data) { tally[r.clinic_id] = (tally[r.clinic_id] || 0) + 1; }
        if (data.length) detail[`${t}.${fk}`] = data.length;
      }
    }
    return { tally, detail };
  }

  for (const p of nullProfiles) {
    const email = p.email || authEmail[p.id] || null;
    const fp = await footprint(p.id);
    const clinicsSeen = Object.keys(fp.tally);
    let proposed = null, basis = null, confidence = null;
    if (clinicsSeen.length === 1) { proposed = clinicsSeen[0]; basis = `활동발자국 단일 clinic 수렴 (${JSON.stringify(fp.detail)})`; confidence = 'HIGH'; }
    else if (clinicsSeen.length === 0 && out.tenancy === 'SINGLE_TENANT') { proposed = out.sole_clinic_id; basis = '단일테넌트 — 유일 clinic 결정론적 (활동발자국 없음)'; confidence = 'MEDIUM'; }
    else if (clinicsSeen.length > 1) {
      // 최다 clinic
      const top = clinicsSeen.sort((a, b) => fp.tally[b] - fp.tally[a]);
      proposed = top[0]; basis = `다중 clinic 발자국 — 최다 수렴 ${JSON.stringify(fp.tally)} (모호: 현장확인 권고)`; confidence = 'LOW';
    } else { proposed = null; basis = '발자국 없음 + 다클리닉 — 현장확인 필요'; confidence = 'NONE'; }

    const rec = {
      id: p.id, email, role: p.role, name: p.name ?? null,
      is_active: p.is_active ?? null, status: p.status ?? null, approved: p.approved ?? null,
      created_at: p.created_at ?? null, created_via: p.created_via ?? null,
      has_ops_authority: p.has_ops_authority ?? null, exempt: p.exempt_from_restrictions ?? null,
      current_clinic_id: p.clinic_id, // = null
      footprint: fp.tally, footprint_detail: fp.detail,
      proposed_clinic_id: proposed, basis, confidence,
    };
    out.null_profiles.push(rec);
    log(`  • ${email || p.id} | role=${p.role} | active=${rec.is_active} | 발자국=${JSON.stringify(fp.tally)} ⇒ 제안=${proposed || '—'} [${confidence}]`);
  }

  // ───────────────────────────────────────────────────────────
  // [4] 역할별 NULL 의미 분기 (계약 L137)
  // ───────────────────────────────────────────────────────────
  log('\n── [4] 역할별 NULL 분기 분류 ──');
  const SINGLE_SITE_ROLES = ['coordinator', 'therapist', 'technician', 'consultant', 'staff']; // 단일지점 귀속 정상
  const MULTI_OK_ROLES = ['admin', 'director']; // multi-clinic 의도 정상 가능 → backfill 보류
  const backfill = [], holdMulti = [], holdAmbiguous = [];
  for (const r of out.null_profiles) {
    if (MULTI_OK_ROLES.includes(r.role)) { holdMulti.push(r); r.classification = '정상 다지점 가능(보류·현장확인)'; }
    else if (SINGLE_SITE_ROLES.includes(r.role)) {
      if (r.proposed_clinic_id && r.confidence !== 'NONE' && r.confidence !== 'LOW') { backfill.push(r); r.classification = '누락(결함)→backfill 대상'; }
      else { holdAmbiguous.push(r); r.classification = '결함이나 매핑 모호→현장확인'; }
    } else { holdAmbiguous.push(r); r.classification = `미정 role(${r.role})→현장확인`; }
  }
  out.classification = {
    backfill_targets: backfill.map(r => ({ id: r.id, email: r.email, role: r.role, proposed_clinic_id: r.proposed_clinic_id, confidence: r.confidence, basis: r.basis })),
    hold_multi_clinic: holdMulti.map(r => ({ id: r.id, email: r.email, role: r.role })),
    hold_ambiguous: holdAmbiguous.map(r => ({ id: r.id, email: r.email, role: r.role, basis: r.basis })),
  };
  log(`  backfill 대상(누락 결함): ${backfill.length}건`);
  backfill.forEach(r => log(`    ✔ ${r.email || r.id} role=${r.role} → ${r.proposed_clinic_id} [${r.confidence}]`));
  log(`  보류(정상 다지점 가능 admin/director): ${holdMulti.length}건`);
  holdMulti.forEach(r => log(`    ⏸ ${r.email || r.id} role=${r.role}`));
  log(`  보류(모호·현장확인): ${holdAmbiguous.length}건`);
  holdAmbiguous.forEach(r => log(`    ❓ ${r.email || r.id} role=${r.role} — ${r.basis}`));

  // ───────────────────────────────────────────────────────────
  // [5] dry-run 기대행수 (apply 단계 삼중가드 검증용)
  // ───────────────────────────────────────────────────────────
  // clinic 별 그룹 (제안 clinic 동일 묶음)
  const byClinic = {};
  for (const r of backfill) { (byClinic[r.proposed_clinic_id] ??= []).push(r.id); }
  out.expected_counts = {
    total_null_profiles: out.null_profiles.length,
    backfill_expected_rows: backfill.length,
    hold_total: holdMulti.length + holdAmbiguous.length,
    by_proposed_clinic: Object.fromEntries(Object.entries(byClinic).map(([c, ids]) => [c, ids.length])),
  };
  log('\n── [5] dry-run 기대행수 ──');
  log('  ' + JSON.stringify(out.expected_counts));

  // 산출 JSON 저장
  const outPath = 'scripts/T-20260630-foot-CODY-CLINICID-BACKFILL_dryrun.out.json';
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  log(`\n✅ DRY-RUN 완료 (prod write 0). 산출: ${outPath}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
