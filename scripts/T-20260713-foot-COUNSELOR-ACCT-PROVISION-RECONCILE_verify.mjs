/**
 * T-20260713-foot-COUNSELOR-ACCT-PROVISION-RECONCILE — READ-ONLY 진단·재검증
 *
 * 목적: 상담실장 김지윤 신규계정(oblivseoul.kr, b36e74a3) provisioning 정합 backfill 前 GROUND TRUTH 확보.
 *   planner NEW-TASK(내 FOLLOWUP 수용) — 불일치 2건 주장:
 *     (1) user_profiles.role='coordinator' vs staff.role='consultant'
 *     (2) user_profiles.clinic_id=NULL vs staff.clinic_id=74967aea
 *   ★로그인복구(COUNSELOR-ACCT-CREATE-FACEOFANGEL)와 별개 축 — 그 apply 가 실제 persist 됐는지 live 재대조.
 *
 * Identity Resolution 표준(GOTRUE-ADMIN-EMAIL-FILTER-BAN) 준수:
 *   INV-1: ?email= 서버필터 첫 결과 신뢰 금지
 *   INV-2: 전량 페이지네이션 소진 후 정규화(trim+lowercase) 완전일치(===)만 후보
 *   INV-3: 0건→not-found / ≥2건→hard error
 *   INV-4: destructive/write 前 getUserById(id) 재조회 email 일치 assert (본 파일은 READ만; write 는 apply.mjs)
 *
 * ★READ-ONLY. 어떤 UPDATE/DELETE 도 실행하지 않음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })();
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TARGET_EMAIL = 'faceofangel9999@oblivseoul.kr';
const GMAIL_EMAIL = 'faceofangel9999@gmail.com';
const EXPECT_UID = 'b36e74a3-be1f-4b61-aeb4-9150affe2c05';
const GMAIL_UID = 'a7e2e012'; // prefix only (무접촉 대상)
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const norm = (s) => (s || '').trim().toLowerCase();

async function resolveByEmailExact(email) {
  // INV-1/2/3: 전량 페이지네이션 소진 후 앱레벨 exact match
  const matches = [];
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error('listUsers 실패: ' + error.message);
    const users = data?.users || [];
    for (const u of users) if (norm(u.email) === norm(email)) matches.push(u);
    if (users.length < perPage) break;
    page += 1;
    if (page > 50) throw new Error('pagination runaway guard');
  }
  return matches;
}

async function main() {
  console.log('=== PROVISION-RECONCILE READ-ONLY 진단 ===\n');

  // (A) Identity: oblivseoul.kr 계정 exact match (INV-2/3)
  const m = await resolveByEmailExact(TARGET_EMAIL);
  console.log(`[A] auth.users exact-match "${TARGET_EMAIL}": ${m.length}건`);
  if (m.length === 0) throw new Error('INV-3: not-found — 대상 계정 부재. ABORT.');
  if (m.length >= 2) throw new Error(`INV-3: 모호(${m.length}건) — destructive 거부. ABORT.`);
  const authUser = m[0];
  console.log(`    → id=${authUser.id} email=${authUser.email}`);
  const idEmailOk = authUser.id === EXPECT_UID && norm(authUser.email) === norm(TARGET_EMAIL);
  console.log(`    → 기대 uid(${EXPECT_UID}) 일치: ${idEmailOk ? 'OK' : '★불일치★'}`);
  if (!idEmailOk) throw new Error('기대 uid 불일치 — 조사 필요. ABORT.');

  // (A-2) INV-4 precursor: getUserById 재조회 email assert
  const { data: byId, error: ge } = await supabase.auth.admin.getUserById(authUser.id);
  if (ge) throw new Error('getUserById 실패: ' + ge.message);
  const gm = norm(byId.user.email) === norm(TARGET_EMAIL);
  console.log(`[A-2] getUserById(${authUser.id}) email 재검증: ${gm ? 'OK' : '★불일치★'} (banned=${byId.user.banned_until || 'null'}, last_sign_in=${byId.user.last_sign_in_at || 'null'})`);
  if (!gm) throw new Error('INV-4: id↔email 불일치 — ABORT.');

  // (B) gmail 계정(무접촉 대상) 존재 확인 — freeze set 격리 근거
  const gmailMatches = await resolveByEmailExact(GMAIL_EMAIL);
  console.log(`\n[B] gmail 계정 "${GMAIL_EMAIL}": ${gmailMatches.length}건` +
    (gmailMatches.length ? ` (id=${gmailMatches[0].id}) — 무접촉 대상, prefix 기대=${GMAIL_UID}` : ' (부재)'));

  // (C) user_profiles 현재 상태 (target)
  const { data: prof, error: pe } = await supabase
    .from('user_profiles').select('*').eq('id', EXPECT_UID).single();
  if (pe) throw new Error('user_profiles read 실패: ' + pe.message);
  console.log('\n[C] user_profiles(target) 현재:', JSON.stringify({
    role: prof.role, clinic_id: prof.clinic_id, active: prof.active,
    approved: prof.approved, access_tier: prof.access_tier,
    exempt_from_restrictions: prof.exempt_from_restrictions,
  }));

  // (D) 링크된 staff row (source of truth 후보)
  let staffRows = [];
  const { data: sByUser, error: se } = await supabase
    .from('staff').select('id, name, role, clinic_id, active, user_id').eq('user_id', EXPECT_UID);
  if (se) console.log('[D] staff(by user_id) read err:', se.message);
  else staffRows = sByUser || [];
  console.log(`[D] staff(user_id=${EXPECT_UID}): ${staffRows.length}건`,
    staffRows.map(s => ({ id: s.id, role: s.role, clinic_id: s.clinic_id, active: s.active })));

  // (E) clinic 확인
  const { data: clinic, error: ce } = await supabase
    .from('clinics').select('id, name, slug').eq('id', CLINIC_ID).maybeSingle();
  if (ce) console.log('[E] clinic read err:', ce.message);
  else console.log('[E] clinic(74967aea):', clinic ? JSON.stringify({ name: clinic.name, slug: clinic.slug }) : 'NULL');

  // (F) 불일치 판정 (planner 주장 대조)
  const staff = staffRows[0];
  const roleMismatch = staff && prof.role !== staff.role;
  const clinicMismatch = prof.clinic_id !== CLINIC_ID;
  console.log('\n=== 불일치 판정 (planner 주장 대조) ===');
  console.log(`(1) role: user_profiles='${prof.role}' vs staff='${staff?.role}' → ${roleMismatch ? '★불일치(정정 필요)★' : '정합'}`);
  console.log(`(2) clinic_id: user_profiles='${prof.clinic_id}' vs 기대='${CLINIC_ID}' (staff='${staff?.clinic_id}') → ${clinicMismatch ? '★불일치(backfill 필요)★' : '정합'}`);

  console.log('\n=== RBAC 게이트 소스 진단 결론 ===');
  console.log('src/lib/permissions.ts canAccess/PERM_MATRIX + App.tsx ProtectedRoute = subject.role(user_profiles.role) 기준.');
  console.log('∴ user_profiles.role 이 RBAC/메뉴 게이트 축 → role UPDATE 는 no-op 아님(불일치 시 정정 필요).');

  console.log('\n결과요약(JSON):', JSON.stringify({
    identity_ok: true, target_uid: EXPECT_UID,
    profile_role: prof.role, profile_clinic_id: prof.clinic_id,
    staff_role: staff?.role, staff_clinic_id: staff?.clinic_id,
    role_needs_fix: !!roleMismatch, clinic_needs_fix: !!clinicMismatch,
    gmail_present: gmailMatches.length > 0,
  }));
}

main().catch(e => { console.error('\n[FATAL]', e.message); process.exit(1); });
