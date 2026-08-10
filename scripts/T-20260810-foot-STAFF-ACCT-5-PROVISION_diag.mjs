/**
 * T-20260810-foot-STAFF-ACCT-5-PROVISION — 진단(READ-ONLY)
 *
 * 목적:
 *  - AC-2: 5개 대상 이메일의 기존 auth 계정 존재 여부를 id↔email 재검증으로 확인
 *          (cross_crm_auth_identity_standard — `?email=` 서버필터 단독 신뢰 금지 →
 *           listUsers 전량 페이지네이션 후 클라이언트-사이드 매칭 + getUserById 교차검증)
 *  - AC-3: 대시보드 중복표시(한예슬/황수진) 근본원인 = staff/user_profiles 중복 row 조사
 *          (이름 기반 + user_id 링크 상태 census)
 *
 * 쓰기 없음. 진단만. 결과 → evidence JSON.
 *
 * 실행: set -a; source .env.local; set +a; node scripts/T-20260810-foot-STAFF-ACCT-5-PROVISION_diag.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const CLINIC_SLUG = 'jongno-foot';
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TARGETS = [
  { name: '게스트',   email: 'footcare@oblivseoul.kr', role: 'therapist',   job: '치료사' },
  { name: '강다연',   email: 'ekdusrkd1@naver.com',    role: 'coordinator', job: '코디네이터' },
  { name: '이진석',   email: 'naspos82@gmail.com',     role: 'coordinator', job: '코디네이터' },
  { name: '황수진',   email: 'hwang5679@gmail.com',    role: 'therapist',   job: '치료사' },
  { name: '한예슬',   email: 'dptmf316@gmail.com',     role: 'therapist',   job: '치료사' },
];
// 대시보드 중복표시 조사 대상 이름 (AC-3)
const DUP_NAMES = ['한예슬', '황수진'];

const lc = (s) => (s || '').trim().toLowerCase();

async function main() {
  const report = { ts: new Date().toISOString(), clinic: null, targets: [], dup_name_census: [], all_staff_count: null };

  // clinic
  const { data: clinic, error: ce } = await supabase.from('clinics').select('id,name,slug').eq('slug', CLINIC_SLUG).single();
  if (ce) throw new Error(`clinics[${CLINIC_SLUG}] 조회 실패: ${ce.message}`);
  report.clinic = clinic;
  console.log(`clinic: ${clinic.name} (${clinic.id})\n`);

  // 전량 auth.users 로드 (서버필터 미사용 — 표준 준수)
  const byEmail = new Map();
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers 실패: ${error.message}`);
    if (!data?.users?.length) break;
    for (const u of data.users) if (u.email) {
      const k = lc(u.email);
      if (!byEmail.has(k)) byEmail.set(k, []);
      byEmail.get(k).push(u);
    }
    if (data.users.length < 1000) break;
    page++;
  }
  console.log(`auth.users 로드: ${byEmail.size} distinct emails\n`);

  for (const t of TARGETS) {
    const k = lc(t.email);
    const matches = byEmail.get(k) || [];
    const entry = { ...t, auth_exists: matches.length > 0, auth_count: matches.length, auth: [], profile: null, staff: [] };

    for (const u of matches) {
      // id↔email 교차검증 (destructive/write 직전 재검증 원칙 — 여기선 진단이나 동일 게이트 적용)
      const { data: byId, error: ge } = await supabase.auth.admin.getUserById(u.id);
      const verified = !ge && lc(byId?.user?.email) === k;
      entry.auth.push({
        id: u.id, email: u.email, id_email_verified: verified,
        email_confirmed_at: u.email_confirmed_at, created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at, banned_until: u.banned_until ?? null,
      });
      // linked profile
      const { data: prof } = await supabase.from('user_profiles').select('id,email,name,role,approved,active,clinic_id').eq('id', u.id).maybeSingle();
      if (prof) entry.profile = prof;
      // linked staff
      const { data: st } = await supabase.from('staff').select('id,name,role,active,clinic_id,user_id').eq('user_id', u.id);
      if (st?.length) entry.staff.push(...st);
    }
    report.targets.push(entry);
    console.log(`[${t.name}] ${t.email} → auth ${entry.auth_count}건 | profile ${entry.profile ? 'Y' : '—'} | staff ${entry.staff.length}행`);
  }

  // AC-3: 이름 기반 staff/profile 중복 census (한예슬/황수진 대시보드 중복표시)
  console.log(`\n── 대시보드 중복표시 census (이름 기반) ──`);
  for (const nm of DUP_NAMES) {
    const { data: staffRows } = await supabase.from('staff').select('id,name,role,active,clinic_id,user_id').eq('name', nm);
    const { data: profRows } = await supabase.from('user_profiles').select('id,email,name,role,approved,active,clinic_id').eq('name', nm);
    report.dup_name_census.push({ name: nm, staff_rows: staffRows || [], profile_rows: profRows || [] });
    console.log(`  [${nm}] staff ${staffRows?.length || 0}행 / user_profiles ${profRows?.length || 0}행`);
    (staffRows || []).forEach(r => console.log(`     staff  id=${r.id} role=${r.role} active=${r.active} clinic=${r.clinic_id} user_id=${r.user_id ?? 'NULL'}`));
    (profRows || []).forEach(r => console.log(`     prof   id=${r.id} email=${r.email} role=${r.role} active=${r.active} clinic=${r.clinic_id}`));
  }

  const out = `scripts/T-20260810-foot-STAFF-ACCT-5-PROVISION_diag-evidence.json`;
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nevidence → ${out}`);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
