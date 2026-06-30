/**
 * T-20260630-foot-STAFF-AUTH-LINK-BACKFILL — DRY-RUN (READ-ONLY, prod write 0)
 *
 * 목적: foot coordinator(및 동일조건 staff 전수) 중 staff.user_id 미연결 행을 추출하고,
 *       user_profiles.id(auth 신원)와 동일 actor 기준(이메일→이름) 1:1 매칭 후보를 산출.
 *       오결합=PHI 귀속 오염(보안속성)이므로 추정 매핑 금지 — positive 증거만 채택,
 *       모호(1:多/多:1/무매칭)는 backfill 제외·현장확인 분류.
 *
 * 안전:
 *  - 오직 SELECT (service_role REST). UPDATE/INSERT/DELETE 호출 없음. prod write 0.
 *  - apply 는 별도 단계(DA CONSULT GO → 김주연 사람확인 → supervisor DB 게이트 後).
 *
 * 증거 우선순위(추정0): ① 정규화 이메일 정확일치(staff.email == user_profiles/auth email)
 *   → ② 이름 정확일치(단, 동명이인 없을 때만) → ③ 모호 시 현장 확인.
 * 1:1 불변식: 제안 user_profiles.id 는 (a) 이미 다른 staff.user_id 로 점유되지 않을 것,
 *   (b) 한 user_profiles 가 복수 staff 후보가 되지 않을 것. 위반 시 hold.
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

const norm = (s) => (s == null ? null : String(s).trim().toLowerCase());
const normName = (s) => (s == null ? null : String(s).replace(/\s+/g, '').toLowerCase());
const out = { ticket: 'T-20260630-foot-STAFF-AUTH-LINK-BACKFILL', generated_at: new Date().toISOString(),
  staff_total: 0, staff_linked: 0, staff_unlinked: 0, rows: [], classification: {}, expected_counts: {} };
const log = (...a) => console.log(...a);

async function tableColumns(table) {
  const { data, error } = await db.from(table).select('*').limit(1);
  if (error) return null;
  return data && data[0] ? Object.keys(data[0]) : [];
}
function pick(cols, cands) { return cands.filter(c => cols?.includes(c)); }

async function main() {
  // ── [0] auth.users 이메일 인덱스 (user_profiles email 부재 보강 + staff↔auth 직매칭) ──
  let authById = {};      // id -> {email, name}
  let authByEmail = {};   // norm(email) -> [id...]
  try {
    let page = 1;
    while (true) {
      const { data: au, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) break;
      for (const u of au?.users || []) {
        const nm = u.user_metadata?.name || u.user_metadata?.full_name || null;
        authById[u.id] = { email: u.email, name: nm };
        const e = norm(u.email);
        if (e) (authByEmail[e] ??= []).push(u.id);
      }
      if (!au?.users || au.users.length < 1000) break;
      page++;
    }
  } catch (e) { log('  (auth 보강 skip:', e.message, ')'); }

  // ── [1] user_profiles 전수 로드 (매칭 대상 신원 풀) ──
  const upCols = await tableColumns('user_profiles');
  if (upCols == null) { console.error('user_profiles 접근 불가'); process.exit(1); }
  const upSel = ['id', 'role',
    ...pick(upCols, ['email', 'name', 'clinic_id', 'is_active', 'status', 'approved', 'created_at'])].join(',');
  const { data: profiles, error: pErr } = await db.from('user_profiles').select(upSel);
  if (pErr) { console.error('user_profiles err', pErr.message); process.exit(1); }
  log(`── [1] user_profiles 총 ${profiles.length}건 로드 ──`);
  // 이메일/이름 인덱스
  const upByEmail = {}, upByName = {};
  for (const p of profiles) {
    const e = norm(p.email) || norm(authById[p.id]?.email);
    const n = normName(p.name) || normName(authById[p.id]?.name);
    p._email = e; p._name = n;
    if (e) (upByEmail[e] ??= []).push(p);
    if (n) (upByName[n] ??= []).push(p);
  }

  // ── [2] staff 전수 로드 + user_id 연결 현황 ──
  const stCols = await tableColumns('staff');
  if (stCols == null) { console.error('staff 접근 불가'); process.exit(1); }
  if (!stCols.includes('user_id')) { console.error('staff.user_id 컬럼 부재 — 스키마 확인 필요'); process.exit(1); }
  const stSel = ['id', 'user_id', 'role',
    ...pick(stCols, ['email', 'name', 'clinic_id', 'active', 'is_active', 'status', 'created_at'])].join(',');
  const { data: staff, error: sErr } = await db.from('staff').select(stSel);
  if (sErr) { console.error('staff err', sErr.message); process.exit(1); }
  out.staff_total = staff.length;
  const linked = staff.filter(s => s.user_id);
  const unlinked = staff.filter(s => !s.user_id);
  out.staff_linked = linked.length;
  out.staff_unlinked = unlinked.length;
  log(`── [2] staff 총 ${staff.length}건 — 연결 ${linked.length} / 미연결 ${unlinked.length} ──`);
  log('  role 분포:', JSON.stringify(staff.reduce((a, s) => ((a[s.role] = (a[s.role] || 0) + 1), a), {})));
  // 이미 점유된 user_profiles.id (1:1 가드용)
  const usedUserIds = new Set(linked.map(s => s.user_id));

  // ── [3] 미연결 staff 행별 매칭 후보 산출 ──
  log('\n── [3] 미연결 staff → user_profiles 매칭 후보 ──');
  // user_profiles 가 복수 staff 의 후보가 되는지 카운트 (多:1 탐지)
  const proposedCount = {};
  for (const s of unlinked) {
    const sEmail = norm(s.email) || norm(authById[s.user_id]?.email);
    const sName = normName(s.name);
    let cand = [], basis = null, confidence = null;

    // ① 이메일 정확일치
    if (sEmail && upByEmail[sEmail]) {
      cand = upByEmail[sEmail].slice();
      basis = `이메일 정확일치 (${sEmail})`;
    }
    // ②  이메일 무매칭 → auth.users 이메일로 직매칭(프로필 email 누락 케이스)
    if (cand.length === 0 && sEmail && authByEmail[sEmail]) {
      const ids = new Set(authByEmail[sEmail]);
      cand = profiles.filter(p => ids.has(p.id));
      if (cand.length) basis = `auth.users 이메일 정확일치 (${sEmail})`;
    }
    // ③ 이름 정확일치 (동명이인 없을 때만 positive)
    if (cand.length === 0 && sName && upByName[sName]) {
      cand = upByName[sName].slice();
      basis = `이름 정확일치 (${s.name})`;
    }

    let proposed = null, status = null;
    const candIds = cand.map(c => c.id);
    const freeCand = cand.filter(c => !usedUserIds.has(c.id)); // 미점유만

    if (cand.length === 0) {
      status = 'NO_MATCH'; confidence = 'NONE'; basis = '이메일·이름 일치 user_profiles 없음 → 현장확인';
    } else if (freeCand.length === 1 && sEmail && (norm(freeCand[0]._email) === sEmail)) {
      proposed = freeCand[0].id; status = 'MATCH'; confidence = 'HIGH';
    } else if (freeCand.length === 1 && basis?.startsWith('이름')) {
      proposed = freeCand[0].id; status = 'MATCH_NAME'; confidence = 'MEDIUM';
      basis += ' (이메일 부재 — 이름 단독, 현장 재확인 권장)';
    } else if (freeCand.length === 1) {
      proposed = freeCand[0].id; status = 'MATCH'; confidence = 'MEDIUM';
    } else if (freeCand.length === 0) {
      status = 'HOLD_OCCUPIED'; confidence = 'NONE';
      basis += ' — 후보 user_profiles 가 이미 타 staff.user_id 로 점유됨(1:1 위반) → 현장확인';
    } else {
      status = 'HOLD_MULTI'; confidence = 'LOW';
      basis += ` — 후보 ${freeCand.length}건(1:多 모호) → 현장확인`;
    }
    if (proposed) proposedCount[proposed] = (proposedCount[proposed] || 0) + 1;

    out.rows.push({
      staff_id: s.id, staff_role: s.role, staff_name: s.name ?? null,
      staff_email: s.email ?? null, staff_clinic_id: s.clinic_id ?? null,
      staff_active: s.active ?? s.is_active ?? null,
      current_user_id: s.user_id ?? null,
      candidate_user_ids: candIds,
      proposed_user_id: proposed, status, confidence, basis,
      proposed_profile: proposed ? (() => { const p = profiles.find(x => x.id === proposed);
        return p ? { id: p.id, email: p._email, name: p.name ?? null, role: p.role, clinic_id: p.clinic_id ?? null } : null; })() : null,
    });
  }

  // 多:1 사후 탐지 (한 user_profiles 가 복수 staff 에 제안됨) → 해당 행 강등
  for (const r of out.rows) {
    if (r.proposed_user_id && proposedCount[r.proposed_user_id] > 1) {
      r.status = 'HOLD_MULTI_REVERSE'; r.confidence = 'LOW';
      r.basis += ` — 동일 user_profiles 가 복수 staff(${proposedCount[r.proposed_user_id]}건)에 제안됨(多:1) → 현장확인`;
      r.proposed_user_id = null;
    }
  }

  out.rows.forEach(r => log(`  • staff=${r.staff_email || r.staff_name || r.staff_id} role=${r.staff_role} ` +
    `⇒ ${r.proposed_user_id || '—'} [${r.status}/${r.confidence}] ${r.basis}`));

  // ── [3.5] 구조적 게이트: staff.email 부재 + 비실인물(장비/플레이스홀더) + 비활성 중복 ──
  // staff 테이블에 email 컬럼이 없으면 AC-1 'positive 증거(이름+이메일 일치)' 구조적 불가 →
  //   이름단독 매칭은 절대 auto-backfill 금지(현장확인). 또한 장비/테스트/플레이스홀더 staff·
  //   비활성 중복행은 backfill 대상 아님(분류 보고).
  const staffHasEmail = stCols.includes('email');
  out.staff_has_email = staffHasEmail;
  const DEVICE_RE = /(테스트장비|패디스캔|오니코|^af$|아톰|데스크|코디$|장비|test)/i;
  for (const r of out.rows) {
    const nm = r.staff_name || '';
    if (!staffHasEmail && (r.confidence === 'MEDIUM' || r.confidence === 'HIGH') && r.basis?.includes('이름')) {
      r.status = 'HOLD_NAME_ONLY'; r.confidence = 'LOW';
      r.basis += ' — staff.email 부재로 이메일 교차검증 불가(AC-1 positive 증거 미충족) → 현장확인';
      r.proposed_user_id = null;
    }
    if (DEVICE_RE.test(nm)) {
      r.likely_nonperson = true;
      r.status = 'HOLD_NONPERSON'; r.confidence = 'NONE';
      r.basis = `비실인물 추정(장비/테스트/플레이스홀더: "${nm}") → user_id 부여 대상 아님(분류보고)`;
      r.proposed_user_id = null;
    }
    if (r.staff_active === false) r.inactive = true;
  }

  // ── [4] 분류 (backfill 대상 vs 현장확인 보류) ──
  const backfill = out.rows.filter(r => r.proposed_user_id && (r.confidence === 'HIGH' || r.confidence === 'MEDIUM'));
  const hold = out.rows.filter(r => !r.proposed_user_id || (r.confidence !== 'HIGH' && r.confidence !== 'MEDIUM'));
  out.classification = {
    backfill_targets: backfill.map(r => ({ staff_id: r.staff_id, staff_email: r.staff_email, role: r.staff_role,
      proposed_user_id: r.proposed_user_id, confidence: r.confidence, basis: r.basis })),
    hold: hold.map(r => ({ staff_id: r.staff_id, staff_email: r.staff_email, role: r.staff_role,
      status: r.status, basis: r.basis })),
  };
  log('\n── [4] 분류 ──');
  log(`  backfill 대상(positive 증거): ${backfill.length}건`);
  backfill.forEach(r => log(`    ✔ ${r.staff_email || r.staff_id} → ${r.proposed_user_id} [${r.confidence}]`));
  log(`  보류(현장확인): ${hold.length}건`);
  hold.forEach(r => log(`    ❓ ${r.staff_email || r.staff_id} — ${r.status}`));

  // ── [5] 기대행수 (apply 삼중가드 검증용) ──
  out.expected_counts = {
    staff_total: out.staff_total,
    staff_unlinked: out.staff_unlinked,
    backfill_expected_rows: backfill.length,
    hold_rows: hold.length,
    backfill_staff_ids: backfill.map(r => r.staff_id),
  };
  log('\n── [5] 기대행수 ──');
  log('  ' + JSON.stringify(out.expected_counts));

  const outPath = 'scripts/T-20260630-foot-STAFF-AUTH-LINK-BACKFILL_dryrun.out.json';
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  log(`\n✅ DRY-RUN 완료 (prod write 0). 산출: ${outPath}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
