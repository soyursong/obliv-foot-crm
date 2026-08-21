/**
 * T-20260820-foot-STAFF-MANUAL-REGISTER-ATOMIC-EF-CONVERGE  (P2, forward-prevention)
 *   수동 '신규 직원 등록'(Staff.tsx CreateStaffDialog) → admin-register-staff 원자 EF 수렴.
 *
 * RC(부모 T-20260820-foot-STAFF-LINKAGE-CORRUPTION-RECURRENCE-GUARD FORENSIC):
 *   수동 등록이 `supabase.from('staff').insert({clinic_id,name,role,active})` 로 user_id 없이 staff 행을
 *   태생시켜(user_id born NULL) linkage 조건(user_id=profile.id AND active AND deleted_at IS NULL) 미충족 →
 *   발행요청 등 기능 disabled (최현희 실장 사고의 상시 원인). user_id 세팅 유일경로 = 원자 EF admin-register-staff.
 *
 * FIX(forward-prevention): CreateStaffDialog 가 bare insert 를 제거하고 공용 helper(registerStaffAtomic)로
 *   원자 EF 를 경유 → 계정 생성 + user_profiles 매핑 + staff user_id 링크 + email 확인을 all-or-nothing.
 *   Accounts.tsx(inviteStaff)도 동일 helper 로 수렴(단일 write-path, divergence 방지).
 *
 * ── 커버리지 설계 (티켓 2 시나리오 → S0/S1) ──────────────────────────────────
 *   [S0 계약가드 — 항상 실행, 무네트워크] 두 수동 등록 진입점(Staff/Accounts)이 원자 EF helper 로
 *     수렴했고, EF 미경유 bare `from('staff').insert` 우회경로가 소멸했으며, 봉투 ok 검사·계정입력
 *     캡처·coord dup guard 보존을 소스계약으로 권위 검증.
 *   [S1 정상신규 링크완결 — live, self-cleaning] 시나리오 1: EF 로 임상직 신규 등록 → staff 행이
 *     user_id 링크 완결(linkage 조건 충족) 관측. EF 미배포/자격 미설정 시 graceful skip.
 */

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_EMAIL = process.env.TEST_EMAIL ?? process.env.TEST_USER_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? process.env.TEST_USER_PASSWORD;

const STAFF_SRC = readFileSync(path.resolve(__dirname, '../../src/pages/Staff.tsx'), 'utf-8');
const ACCOUNTS_SRC = readFileSync(path.resolve(__dirname, '../../src/pages/Accounts.tsx'), 'utf-8');
const LIB_SRC = readFileSync(path.resolve(__dirname, '../../src/lib/staffRegister.ts'), 'utf-8');

function loadServiceClient(): SupabaseClient | null {
  if (!SUPA_URL || !SERVICE_KEY) return null;
  return createClient(SUPA_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signedInClient(): Promise<SupabaseClient | null> {
  if (!SUPA_URL || !ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD) return null;
  const supa = createClient(SUPA_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supa.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (error) return null;
  return supa;
}

/** CreateStaffDialog(save) 블록만 슬라이스 — Staff.tsx 내 다른 write 경로와 격리해 검증. */
function createStaffDialogBlock(): string {
  const start = STAFF_SRC.indexOf('function CreateStaffDialog');
  const end = STAFF_SRC.indexOf('function EditStaffDialog');
  expect(start, 'CreateStaffDialog 정의 필요').toBeGreaterThan(-1);
  expect(end, 'EditStaffDialog 정의 필요(경계)').toBeGreaterThan(start);
  return STAFF_SRC.slice(start, end);
}

test.describe('T-20260820-foot-STAFF-MANUAL-REGISTER-ATOMIC-EF-CONVERGE', () => {
  // ═══ S0-STAFF: 수동 '신규 직원 등록'이 원자 EF helper 로 수렴 + bare insert 제거 ═══════
  test('S0-STAFF: CreateStaffDialog 가 registerStaffAtomic 경유 + bare staff.insert 우회경로 소멸', () => {
    const block = createStaffDialogBlock();
    // (a) 공용 원자 EF helper 로 등록
    expect(block, 'CreateStaffDialog 는 registerStaffAtomic 를 호출해야 함')
      .toContain('registerStaffAtomic');
    expect(STAFF_SRC, "staffRegister helper import 필요")
      .toContain("from '@/lib/staffRegister'");
    // (b) ★재발원 봉인: CreateStaffDialog 내 bare `from('staff').insert` 우회경로 소멸
    expect(/from\(['"]staff['"]\)\s*\.insert/.test(block),
      "CreateStaffDialog 에 bare from('staff').insert (user_id 태생 NULL) 잔재 없어야 함").toBe(false);
    // (c) 계정 입력(email/password) 캡처 — 원자 EF 가 user_id 세팅에 요구
    expect(block, '이메일 입력 상태 필요').toContain('setEmail');
    expect(block, '임시 비밀번호 입력 상태 필요').toContain('setPassword');
    expect(block, 'staffId:null 로 EF 위임(임상직 자동매칭/신규생성)').toMatch(/staffId:\s*null/);
    // (d) 봉투 검사: result.ok 실패처리(silent-success 차단)
    expect(/!result\.ok/.test(block), 'EF 봉투 result.ok 실패 검사 필요').toBe(true);
    // (e) coordinator 중복 forward-guard(T-20260810) 보존 — 수렴이 기존 가드를 삭제하지 않음
    expect(block, 'coordinator dup guard(evaluateCoordinatorDup) 보존 필요')
      .toContain('evaluateCoordinatorDup');
  });

  // ═══ S0-LIB: 공용 helper 가 원자 EF 를 봉투·Bearer 로 호출 ═══════════════════════
  test('S0-LIB: registerStaffAtomic 이 ADMIN_REGISTER_STAFF EF 를 Bearer+봉투검사로 호출한다', () => {
    expect(LIB_SRC, 'ADMIN_REGISTER_STAFF EF 레지스트리 경유 필요')
      .toContain('EDGE_FUNCTIONS.ADMIN_REGISTER_STAFF');
    expect(LIB_SRC, 'functions.invoke 경유 필요').toContain('functions.invoke');
    expect(/Authorization:\s*`Bearer \$\{accessToken\}`/.test(LIB_SRC),
      'EF 호출 시 세션 access_token 을 Bearer 로 전달해야 함').toBe(true);
    expect(/\.ok\s*!==\s*true/.test(LIB_SRC),
      'EF 봉투 ok===true 만 성공(silent-success 차단)').toBe(true);
    // helper 는 FE 직접 signUp / RPC 를 하지 않음(EF 원자 오케스트레이션 위임)
    expect(LIB_SRC.includes('auth.signUp'), 'helper 는 FE 직접 signUp 금지').toBe(false);
    expect(LIB_SRC.includes("rpc('admin_register_user'"),
      'helper 는 FE 직접 admin_register_user RPC 금지(EF 경유)').toBe(false);
  });

  // ═══ S0-ACCOUNTS: 기존 등록 진입점도 동일 helper 로 수렴(단일 write-path·중복정의 제거) ═══
  test('S0-ACCOUNTS: inviteStaff 가 registerStaffAtomic 로 수렴 + 로컬 helper 중복정의 제거', () => {
    const inviteIdx = ACCOUNTS_SRC.indexOf('const inviteStaff');
    const saveIdx = ACCOUNTS_SRC.indexOf('const saveEdit');
    expect(inviteIdx).toBeGreaterThan(-1);
    const inviteBlock = ACCOUNTS_SRC.slice(inviteIdx, saveIdx > inviteIdx ? saveIdx : undefined);
    expect(inviteBlock, 'inviteStaff 는 공용 helper 로 수렴').toContain('registerStaffAtomic');
    // 로컬 중복정의 제거(divergence 방지) — 공용 lib 로 이전
    expect(ACCOUNTS_SRC.includes('function generateTempPassword'),
      'generateTempPassword 로컬 중복정의 제거(공용 lib 이전)').toBe(false);
    expect(ACCOUNTS_SRC.includes('function isAlreadyRegistered'),
      'isAlreadyRegistered 로컬 중복정의 제거(공용 lib 이전)').toBe(false);
    expect(ACCOUNTS_SRC, '공용 lib import 필요').toContain("from '@/lib/staffRegister'");
    // 회귀0: 봉투 ok 실패처리 유지 + 이미등록 명시문구 유지
    expect(/!result\.ok/.test(inviteBlock), '봉투 실패검사 유지').toBe(true);
    expect(inviteBlock, '이미 등록된 계정 명시문구 유지').toContain('이미 등록된 계정입니다');
  });

  // ═══ S1(시나리오 1): 정상 신규 등록 → staff user_id 링크 완결(live, self-cleaning) ══════
  test('S1: EF 로 임상직 신규 등록 시 staff 행 user_id 링크 완결(linkage 조건 충족)', async () => {
    const supa = await signedInClient();
    if (!supa) { test.skip(true, 'QA 인증 실패 — 자격정보 미설정'); return; }
    const svc = loadServiceClient();
    if (!svc) { await supa.auth.signOut(); test.skip(true, 'service_role 미설정 — 자가정리 불가로 live 생성 skip'); return; }

    const uniq = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const email = `e2e-manualreg-${uniq}@obliv-foot.kr`;
    const tmpPw = ['E', 'p', uniq.slice(-4), '!', 'aZ9'].join('');
    const { data: { session } } = await supa.auth.getSession();

    // 수동 등록 폼과 동형 입력(임상직 therapist, staff_id 미지정 → RPC 신규 staff 생성 + user_id 세팅).
    const resp = await supa.functions.invoke('admin-register-staff', {
      body: { email, password: tmpPw, name: '__E2E_MANUALREG__', role: 'therapist' },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    test.info().annotations.push({
      type: 's1-ef-result',
      description: `transportErr=${JSON.stringify(resp.error)} body=${JSON.stringify(resp.data)}`,
    });

    if (resp.error && !resp.data) {
      await supa.auth.signOut();
      test.skip(true, `EF 미배포/도달불가 — 배포 후 재실행: ${JSON.stringify(resp.error)}`);
      return;
    }

    const body = resp.data as {
      ok?: boolean; error?: { message?: string } | null;
      data?: { user_id?: string; staff_id?: string | null; role?: string };
    };
    let uid: string | undefined;
    try {
      expect(resp.error, 'transport error 없어야 함').toBeFalsy();
      expect(body?.ok, `봉투 ok:true 여야 함(err=${body?.error?.message})`).toBe(true);
      uid = body?.data?.user_id;
      expect(uid, 'user_id 반환 필요').toBeTruthy();

      // ★핵심 검증: staff 행이 user_id 링크 완결(태생 NULL 아님) + linkage 조건 충족.
      const { data: staffRow } = await svc
        .from('staff')
        .select('id, user_id, active, deleted_at, role')
        .eq('user_id', uid!)
        .maybeSingle();
      expect(staffRow, '등록 후 user_id 로 링크된 staff 행이 존재해야 함(태생 NULL 아님)').toBeTruthy();
      const s = staffRow as { user_id?: string; active?: boolean; deleted_at?: string | null } | null;
      expect(s?.user_id, 'staff.user_id = 계정 id (링크 완결)').toBe(uid);
      // linkage 조건: user_id NOT NULL AND active=true AND deleted_at IS NULL
      expect(s?.active, 'linkage 조건 active=true').toBe(true);
      expect(s?.deleted_at ?? null, 'linkage 조건 deleted_at IS NULL').toBeNull();
    } finally {
      if (uid) {
        await svc.from('staff').delete().eq('user_id', uid);
        await svc.from('user_profiles').delete().eq('id', uid);
        await svc.auth.admin.deleteUser(uid).catch(() => {});
      }
      await supa.auth.signOut();
    }
  });
});
