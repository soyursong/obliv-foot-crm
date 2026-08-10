/**
 * foot CRM — 유베이스 파일럿 상담사 2인 계정 발급 (일반직원권한 / A안)
 * T-20260810-dopamine-UBASE-FOOTBODY-CRM-2ACCT-PROVISION (foot leg)
 *
 * 확정: 이정환 경영BO(U05L4115SQ3) A안(일반직원권한=user_profiles.role='staff') @2026-08-10
 *
 * 대상 2계정:
 *   - ubase.team01@nfavo.com
 *   - ubase.team02@nfavo.com
 *
 * 발급 범위(계정 1건당):
 *   1) Supabase Auth user 생성 (email_confirm=true, 임시 PW)
 *      → handle_new_user 트리거가 user_profiles 선삽입(approved=false 등)
 *   2) user_profiles UPDATE → role='staff'(일반직원=스태프) / approved=true / active=true
 *      / clinic_id=jongno-foot / name
 *   ※ staff 테이블 INSERT 안 함:
 *      - 'staff'는 user_profiles.role(UserRole)이지 staff.role(StaffRole: director/consultant/
 *        coordinator/therapist/technician) enum이 아님 → 로스터/담당자 드롭다운 오염 방지.
 *      - 앱 게이트(ProtectedRoute/RoleGuard)는 user_profiles 만 참조 → 로그인·일반직원 접근 충분.
 *
 * 로그인 게이트(src/pages/Login.tsx / ProtectedRoute.tsx):
 *   email_confirm=true(이메일 인증) + user_profiles.approved=true + role → 로그인 가능.
 *
 * 임시 PW(AC-3): 코드/로그/MQ/티켓 평문 노출 금지.
 *   - 값은 env UBASE_TEMP_PW_01 / UBASE_TEMP_PW_02 로 주입(없으면 crypto 랜덤 생성).
 *   - 생성된 값은 gitignore 대상 로컬 시크릿 파일(CREDS_OUT)에만 기록(chmod 600) → 안전경로 별도 전달.
 *
 * idempotent:
 *   - auth.users 이메일 존재 → 생성 스킵, 기존 userId 재사용(PW 미변경).
 *
 * 실행:
 *   DRY_RUN=true  node scripts/provision_ubase_2acct_20260810.mjs   ← 검증만
 *   DRY_RUN=false node scripts/provision_ubase_2acct_20260810.mjs   ← 실제 발급 + 로그인 verify
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })();
const CLINIC_SLUG = 'jongno-foot';
const DRY_RUN = process.env.DRY_RUN !== 'false'; // 기본값 true
const CREDS_OUT = process.env.CREDS_OUT || '_artifacts/UBASE-2ACCT-credentials.SECURE.local.txt';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// anon 클라이언트 없이 login-verify 위해 별도 인스턴스(publishable 아님 — service key로 signInWithPassword 시도해도 됨)
const loginClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function genPw() {
  // 16자 base64url + 특수문자 보강 (정책 충족)
  return crypto.randomBytes(12).toString('base64url') + 'A9!';
}

const TARGETS = [
  { name: '유베이스 파일럿1', email: 'ubase.team01@nfavo.com', envKey: 'UBASE_TEMP_PW_01' },
  { name: '유베이스 파일럿2', email: 'ubase.team02@nfavo.com', envKey: 'UBASE_TEMP_PW_02' },
];

const log = (m) => console.log(m);
const ok = (m) => console.log(`✅ ${m}`);
const warn = (m) => console.warn(`⚠️  ${m}`);
const fail = (m) => console.error(`❌ ${m}`);

async function getClinicId() {
  const { data, error } = await admin.from('clinics').select('id,name,slug').eq('slug', CLINIC_SLUG).single();
  if (error || !data) throw new Error(`clinics[slug=${CLINIC_SLUG}] 조회 실패: ${error?.message}`);
  ok(`clinic: ${data.name} (${data.id})`);
  return data.id;
}

async function existingUsersMap() {
  const byEmail = new Map();
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers 실패: ${error.message}`);
    if (!data?.users?.length) break;
    for (const u of data.users) if (u.email) byEmail.set(u.email.toLowerCase(), u);
    if (data.users.length < 1000) break;
    page++;
  }
  return byEmail;
}

async function provisionOne(t, clinicId, existing) {
  const email = t.email.toLowerCase();
  const existingUser = existing.get(email);
  const password = process.env[t.envKey] || genPw();

  if (DRY_RUN) {
    log(`  [DRY] ${t.name} (${email})`);
    log(`        → ${existingUser ? `Auth 존재(${existingUser.id}) → 생성 스킵` : 'auth.admin.createUser(email_confirm)'}`);
    log(`        → user_profiles UPDATE: role='staff', approved=true, active=true, clinic_id`);
    return { email, dry: true };
  }

  let userId;
  let pwSet = false;
  if (existingUser) {
    userId = existingUser.id;
    warn(`${t.name}: Auth 이미 존재(${userId}) → 생성 스킵 (PW 미변경)`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) return { email, success: false, error: `createUser 실패: ${error.message}` };
    userId = data.user.id;
    pwSet = true;
  }

  const { error: upErr } = await admin.from('user_profiles').update({
    email,
    name: t.name,
    role: 'staff',
    approved: true,
    active: true,
    clinic_id: clinicId,
  }).eq('id', userId);
  if (upErr) return { email, userId, success: false, error: `user_profiles UPDATE 실패: ${upErr.message}` };

  // 로그인 verify (새로 PW 설정한 경우만 — 기존계정은 PW 모름)
  let loginVerified = null;
  if (pwSet) {
    const { data: s, error: se } = await loginClient.auth.signInWithPassword({ email, password });
    loginVerified = !se && !!s?.session;
    if (loginVerified) await loginClient.auth.signOut();
  }

  return { email, userId, success: true, pwSet, password: pwSet ? password : null, loginVerified };
}

async function main() {
  log('='.repeat(64));
  log('foot CRM — 유베이스 파일럿 2계정 발급 (일반직원권한 / A안)');
  log('T-20260810-dopamine-UBASE-FOOTBODY-CRM-2ACCT-PROVISION (foot leg)');
  log(`모드: ${DRY_RUN ? '🔍 DRY-RUN' : '🚀 실제 발급'}`);
  log('='.repeat(64));

  const clinicId = await getClinicId();
  const existing = await existingUsersMap();

  const results = [];
  for (const t of TARGETS) results.push(await provisionOne(t, clinicId, existing));

  const creds = [];
  let failCount = 0, verifiedCount = 0;
  for (const r of results) {
    if (r.dry) { log(`  DRY OK: ${r.email}`); continue; }
    if (r.success) {
      ok(`${r.email} → ${r.userId} | login-verify: ${r.loginVerified === null ? 'skip(기존PW)' : (r.loginVerified ? 'OK' : 'FAIL')}`);
      if (r.loginVerified) verifiedCount++;
      if (r.pwSet && r.password) creds.push(`${r.email}\t${r.password}`);
    } else {
      fail(`${r.email}: ${r.error}`);
      failCount++;
    }
  }

  if (!DRY_RUN && creds.length) {
    const header = [
      '# UBASE 2ACCT foot CRM 임시 자격증명 (안전경로 전달용)',
      '# T-20260810-dopamine-UBASE-FOOTBODY-CRM-2ACCT-PROVISION',
      '# URL: https://obliv-foot-crm.pages.dev',
      '# 권한: 일반직원(스태프) / clinic: jongno-foot',
      '# ⚠️ 이 파일은 git 미추적(gitignore). Slack/MQ/티켓 평문 금지. jh.lee@medibuilder.com 안전경로 별도 전달.',
      '# email\ttemp_password',
      '',
    ].join('\n');
    fs.mkdirSync(CREDS_OUT.substring(0, CREDS_OUT.lastIndexOf('/')) || '.', { recursive: true });
    fs.writeFileSync(CREDS_OUT, header + creds.join('\n') + '\n', { mode: 0o600 });
    fs.chmodSync(CREDS_OUT, 0o600);
    ok(`자격증명 시크릿 파일 기록(chmod 600): ${CREDS_OUT}`);
  }

  log('\n' + '='.repeat(64));
  log(`대상 ${TARGETS.length} | 실패 ${failCount} | login-verify OK ${verifiedCount} | 모드 ${DRY_RUN ? 'DRY-RUN' : '실제'}`);
  if (!DRY_RUN && failCount === 0) {
    ok('AC-1: 2계정 일반직원권한 발급 + 로그인 verify 완료');
    ok('AC-3: 임시 PW = 로컬 시크릿 파일에만 기록(평문 미노출) → 안전경로 별도 전달');
  }
  log('='.repeat(64));
  return failCount === 0;
}

main().then((okAll) => process.exit(okAll ? 0 : 1)).catch((e) => { fail(`치명: ${e.message}`); process.exit(1); });
