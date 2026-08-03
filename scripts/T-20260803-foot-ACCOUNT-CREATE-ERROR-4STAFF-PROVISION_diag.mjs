/**
 * T-20260803-foot-ACCOUNT-CREATE-ERROR-4STAFF-PROVISION — ① 진단 (READ-ONLY)
 *
 * 목적: 계정 생성 에러 근본원인 특정 + 4명 대상 현황(중복/미확인/정합) 조사.
 *   - cross_crm_auth_identity_standard 준수: GoTrue admin list-users 전량 페이지네이션 후
 *     정규화 이메일 완전일치(INV-1,2,3). ?email= 서버필터 단독신뢰 금지.
 *   - user_profiles / staff 정합 동반 조회.
 *   - signUp 경로 재현: anon 키로 signUp 시도해 실제 에러 메시지 캡처(중복이면 identities=[]).
 *
 * READ-ONLY: 어떤 write 도 하지 않음(진단 전용). signUp 재현은 no-write(중복이면 row 미생성).
 * 실행: SUPABASE_SERVICE_ROLE_KEY=.. VITE_SUPABASE_ANON_KEY=.. node scripts/..._diag.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })();
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.ANON_KEY || '';
const svc = createClient(URL, KEY, { auth: { persistSession: false } });

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot (KGMIN 선례)

const TARGETS = [
  { name: '송민근', role: 'consultant', email: 'mhsong12@naver.com' },
  { name: '이정인', role: 'therapist',  email: 'dlwjddls993@naver.com' },
  { name: '이은희', role: 'therapist',  email: 'ebline1@naver.com' },
  { name: '진이서', role: 'consultant', email: 'glgdmskd6@naver.com' },
];

// resolveUserByEmail — cross-CRM canonical (INV-1,2,3): 전량 스캔 + 정확매칭.
async function resolveUserByEmail(admin, rawEmail) {
  const email = (rawEmail ?? '').trim().toLowerCase();
  const matches = [];
  const perPage = 1000;
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error('LIST_FAILED: ' + error.message);
    const users = data?.users ?? [];
    for (const u of users) if ((u.email ?? '').trim().toLowerCase() === email) matches.push(u);
    if (users.length < perPage) break;
  }
  if (matches.length === 0) return { status: 'NOT_FOUND' };
  if (matches.length > 1) return { status: 'AMBIGUOUS', count: matches.length };
  return { status: 'FOUND', user: matches[0] };
}

async function main() {
  console.log('=== T-20260803 ACCOUNT-CREATE 진단 (READ-ONLY) ===', new Date().toISOString());
  console.log('clinic_id =', CLINIC_ID, '\n');

  for (const t of TARGETS) {
    console.log(`\n── ${t.name} / ${t.role} / ${t.email} ──`);
    const r = await resolveUserByEmail(svc, t.email);
    if (r.status === 'AMBIGUOUS') { console.log(`  ⚠ GoTrue AMBIGUOUS (${r.count}건) — 이메일 유니크 위반 신호`); continue; }
    if (r.status === 'NOT_FOUND') {
      console.log('  GoTrue auth.users: 없음 (신규 생성 대상)');
    } else {
      const u = r.user;
      console.log('  GoTrue auth.users: 존재 ✅  id=' + u.id);
      console.log('    email_confirmed_at =', u.email_confirmed_at || 'NULL (← 로그인 블로커: "Email not confirmed")');
      console.log('    banned_until       =', u.banned_until ?? 'null');
      console.log('    last_sign_in_at    =', u.last_sign_in_at || 'never');
      console.log('    created_at         =', u.created_at);
      // user_profiles / staff 정합
      const { data: prof } = await svc.from('user_profiles').select('id,name,role,approved,active,clinic_id').eq('id', u.id).maybeSingle();
      const { data: st } = await svc.from('staff').select('id,name,role,active,clinic_id,user_id').eq('user_id', u.id).maybeSingle();
      console.log('    user_profiles      =', prof ? JSON.stringify(prof) : 'NULL (프로필 미매핑)');
      console.log('    staff(user_id link)=', st ? JSON.stringify(st) : 'NULL (staff 미링크)');
    }
    // staff 이름 매칭(user_id NULL 인 대기 staff row 있는지) — inviteStaff 자동매핑 후보
    const { data: nameStaff } = await svc.from('staff').select('id,name,role,active,user_id').eq('clinic_id', CLINIC_ID).eq('name', t.name);
    if (nameStaff && nameStaff.length) console.log('    staff(name매칭)     =', JSON.stringify(nameStaff));
  }

  // ── signUp 경로 재현 (FE Accounts.tsx inviteStaff 1단계) — 실제 에러 메시지 캡처 ──
  // PROBE_SIGNUP=true 일 때만: 신규 이메일이면 실제 auth.users 생성/확인메일 발송 side-effect 있음.
  console.log('\n\n=== signUp 경로 재현 (FE 에러 재현, anon 키) ===');
  if (process.env.PROBE_SIGNUP !== 'true') { console.log('  PROBE_SIGNUP!=true → 재현 스킵(READ-ONLY 유지). 필요 시 PROBE_SIGNUP=true 로 재실행.'); }
  else if (!ANON) { console.log('  ANON 키 없음 → signUp 재현 스킵'); }
  else {
    const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const t of TARGETS) {
      const probePw = 'DiagProbe!' + Math.floor(Math.random()*100000); // gitleaks:allow (랜덤 프로브 문자열, 실 secret 아님)
      const { data, error } = await anon.auth.signUp({
        email: t.email, password: probePw,
        options: { data: { name: t.name } },
      });
      if (error) {
        console.log(`  ${t.email}: ❌ signUp ERROR → "${error.message}" (status=${error.status ?? '?'})`);
      } else if (!data.user?.identities || data.user.identities.length === 0) {
        console.log(`  ${t.email}: ⚠ 중복(identities=[]) — FE는 "이미 등록된 이메일" 표출 (row 미생성)`);
      } else {
        console.log(`  ${t.email}: ✅ signUp 성공(신규 auth.users 생성됨! uid=${data.user.id}) — ⚠진단이 계정 생성함, provisioning 단계서 재사용/정리`);
      }
    }
  }
  console.log('\n[DONE] 진단 완료.');
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
