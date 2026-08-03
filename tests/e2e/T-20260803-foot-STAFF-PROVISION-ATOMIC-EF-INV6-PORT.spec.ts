/**
 * T-20260803-foot-STAFF-PROVISION-ATOMIC-EF-INV6-PORT  (P2, 구조적 재발원 제거)
 *   풋 계정등록 비원자 3단 클라흐름 → body pilot INV-6 원자 오케스트레이터 EF 이식.
 *   body pilot 참조: obliv-body-crm admin-register-staff (commit 15d18d00, 배포 2026-07-15 02:11 KST).
 *   governing SSOT: cross_crm_auth_identity_standard §INV-6 (body=canonical pilot, foot=횡전개).
 *
 * RC: 기존 Accounts.tsx#inviteStaff = 비원자 3단(signUp → admin_register_user RPC →
 *     admin_approve_and_confirm_user RPC). (2)/(3) 실패 시 (1) 무롤백 → 미확인·기본role(staff)·
 *     approved=false 고아 auth.users 잔존 → 동일 email 재등록 "User already registered" 전면차단
 *     (이정인/이은희/진이서 실증). §INV-6 이 경고한 정확한 위험.
 * FIX: 신규 EF `admin-register-staff` 가 createUser(email_confirm:true) + admin_register_user RPC +
 *     admin_approve_and_confirm_user 를 원자 오케스트레이션한다. RPC 실패 시 "이번에 새로 만든"
 *     auth.users 만 보상삭제(INV-4 재검증 선행)하고, 기존(고아 포함) 계정은 self-heal(id 재사용)한다.
 *     FE 는 EF 1콜 + 봉투 {ok,error} 하나만 검사(구 비원자 클라 경로 전량 제거).
 *
 * ── 커버리지 설계 (티켓 3 시나리오 → S0/S1/S2/S3) ────────────────────────────
 *   [S0 계약가드 — 항상 실행, 무네트워크] EF/FE/config 소스가 원자화·봉투·보상삭제·self-heal·
 *     role매핑·INV 계약을 만족하는지. 실패-롤백/self-heal 경로는 prod 에 파괴적 실패주입 hook 이
 *     없어 소스계약으로 권위 검증(시나리오 2·3 의 코드계약 파트).
 *   [S1 정상신규 — live, self-cleaning] 시나리오 1: EF 배포+service_role 가용 시 실제 등록→봉투
 *     ok:true→auth/profile 짝맞음→자가정리.
 *   [S3 고아 parity — live] 시나리오 2·3 관측: auth.users ↔ user_profiles 고아 0(원자화 정착 관측).
 *   live 파트는 EF 미배포/자격 미설정 시 graceful skip (supervisor QA 환경 의존).
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

const EF_SRC = readFileSync(
  path.resolve(__dirname, '../../supabase/functions/admin-register-staff/index.ts'),
  'utf-8',
);
const FE_SRC = readFileSync(
  path.resolve(__dirname, '../../src/pages/Accounts.tsx'),
  'utf-8',
);
const REG_SRC = readFileSync(
  path.resolve(__dirname, '../../src/lib/externalServices.ts'),
  'utf-8',
);

// foot = 단일 dev=prod Supabase(rxlomoozakkjesdqjtvd). service_role 는 env 로만(코드/로그/커밋 노출 금지).
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

test.describe('T-20260803-foot-STAFF-PROVISION-ATOMIC-EF-INV6-PORT', () => {
  // ═══ S0-FE: FE 계약가드 — EF 1콜 전환 + 봉투 검사 + 비원자 3단 흐름 제거 ═══════
  test('S0-FE: inviteStaff 가 admin-register-staff EF 1콜 + 봉투 ok 검사로 전환됐다', () => {
    // (a) EF invoke 로 전환(레지스트리 상수 경유)
    expect(FE_SRC, 'inviteStaff 가 ADMIN_REGISTER_STAFF EF 를 invoke 해야 함')
      .toContain('EDGE_FUNCTIONS.ADMIN_REGISTER_STAFF');
    expect(FE_SRC, 'functions.invoke 경유여야 함').toContain('functions.invoke');
    // (b) 레지스트리에 EF 이름 등록
    expect(REG_SRC, 'externalServices 에 ADMIN_REGISTER_STAFF: admin-register-staff 등록 필요')
      .toMatch(/ADMIN_REGISTER_STAFF:\s*'admin-register-staff'/);
    // (c) 비원자 3단 흐름 제거: FE 직접 signUp / 별도 signupClient 잔재 없음(고아 생성기전 제거)
    expect(FE_SRC.includes('signupClient'), 'signupClient(FE signUp 경로) 잔재 없어야 함').toBe(false);
    expect(FE_SRC.includes('auth.signUp'), 'FE 직접 auth.signUp 잔재 없어야 함').toBe(false);
    // (d) inviteStaff 블록이 admin_register_user / admin_approve_and_confirm_user 를 FE 직접 호출하지 않음
    const inviteIdx = FE_SRC.indexOf('const inviteStaff');
    const saveIdx = FE_SRC.indexOf('const saveEdit');
    expect(inviteIdx).toBeGreaterThan(-1);
    const inviteBlock = FE_SRC.slice(inviteIdx, saveIdx > inviteIdx ? saveIdx : undefined);
    expect(inviteBlock.includes("rpc('admin_register_user'"),
      'inviteStaff 는 EF 경유 — FE 직접 admin_register_user RPC 잔재 없어야 함').toBe(false);
    expect(inviteBlock.includes("rpc('admin_approve_and_confirm_user'"),
      'inviteStaff 는 EF 경유 — FE 직접 admin_approve_and_confirm_user RPC 잔재 없어야 함').toBe(false);
    // (e) 봉투 검사: ok!==true 를 실패 처리(silent success 차단)
    expect(/\.ok\s*!==\s*true/.test(inviteBlock),
      'EF 봉투 ok===true 만 성공 처리해야 함(silent-success 차단)').toBe(true);
    // (f) 세션 JWT 를 Bearer 로 실어야 함(EF 가 호출자 게이트 검증)
    expect(/Authorization:\s*`Bearer \$\{accessToken\}`/.test(inviteBlock),
      'EF 호출 시 세션 access_token 을 Bearer 로 전달해야 함').toBe(true);
  });

  // ═══ S0-EF: EF 계약가드 — 원자화·보상삭제·self-heal·INV·role매핑·키 미노출 ═══════
  test('S0-EF: admin-register-staff EF 가 원자화/보상삭제/self-heal/INV/키격리 계약을 만족한다', () => {
    // (원자성) rpcErr(transport/RAISE) 검사 + 방어적 jsonb error 병행
    expect(/rpcErr\s*\|\|\s*jsonbError/.test(EF_SRC), 'rpcErr(RAISE) + jsonbError 병행 검사 필요').toBe(true);
    // (보상삭제) 존재 + 신규계정(createdNew)일 때만 삭제(재사용 고아 보존 = pre-existing 무접촉)
    expect(EF_SRC, 'deleteUser 보상삭제 경로 필요').toContain('deleteUser');
    const failIdx = EF_SRC.indexOf('if (rpcErr || jsonbError)');
    expect(failIdx).toBeGreaterThan(-1);
    const failBlock = EF_SRC.slice(failIdx, failIdx + 1600);
    expect(failBlock.includes('if (createdNew)'),
      '보상삭제는 createdNew(신규계정)일 때만 — 재사용 고아·pre-existing 계정 절대 삭제 금지').toBe(true);
    // (INV-4) 삭제 직전 id↔email 재검증(assertUserIdentity) 선행
    const delIdx = EF_SRC.indexOf('deleteUser(targetUserId)');
    const assertIdx = EF_SRC.indexOf('assertUserIdentity(admin, targetUserId, email)');
    expect(assertIdx, 'assertUserIdentity(INV-4) 필요').toBeGreaterThan(-1);
    expect(assertIdx, 'deleteUser 前 assertUserIdentity(INV-4) 선행 필요').toBeLessThan(delIdx);
    // (self-heal) 기존 고아(user_profiles 매핑 無)면 id 재사용, createUser 건너뜀
    expect(EF_SRC, '고아 self-heal(id 재사용) 경로 필요').toContain('orphan_reuse');
    expect(/targetUserId\s*=\s*existing\.id/.test(EF_SRC), '고아 id 재사용 필요').toBe(true);
    // (INV-1~3) resolveUserByEmail 전량 페이지네이션 + 정확매칭 + 모호성 fail-closed
    expect(EF_SRC, 'listUsers 전량조회(INV-1) 필요').toContain('listUsers');
    expect(EF_SRC, '모호성 fail-closed(INV) 필요').toContain('AMBIGUOUS_EMAIL');
    // (email 확인) 원자 EF 안에서 admin_approve_and_confirm_user 로 email 확인 보증(고아 재사용 대비)
    expect(EF_SRC, 'email 확인 RPC 흡수 필요').toContain('admin_approve_and_confirm_user');
    // (role 매핑) 풋 role SSOT — 임상직 + part_lead/technician 포함, body 의 space 미포함
    expect(EF_SRC, 'part_lead 풋 role 필요').toContain('part_lead');
    expect(EF_SRC, 'technician 풋 role 필요').toContain('technician');
    expect(EF_SRC.includes("'space'"), "풋 EF 에 body 전용 'space' role 없어야 함").toBe(false);
    // (호출자 게이트) 풋 admin/manager/director
    expect(EF_SRC, '호출자 게이트 CALLER_ALLOWED_ROLES 필요').toContain('CALLER_ALLOWED_ROLES');
    expect(/CALLER_ALLOWED_ROLES\s*=\s*new Set\(\['admin',\s*'manager',\s*'director'\]\)/.test(EF_SRC),
      '풋 호출자 게이트 = admin/manager/director(is_admin_or_manager 일치)').toBe(true);
    // (풋 RPC 시그니처) link_existing_staff 미사용(풋 admin_register_user 인자 없음)
    expect(EF_SRC.includes('link_existing_staff'),
      '풋 admin_register_user 는 link_existing_staff 인자 없음 — 전달 금지').toBe(false);
    // (키 미노출) service_role 은 SUPABASE_SERVICE_ROLE_KEY 에서만, VITE_ 노출 없음
    expect(EF_SRC, 'service_role 은 SUPABASE_SERVICE_ROLE_KEY').toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(EF_SRC.includes('VITE_'), 'EF 에 VITE_ (프론트 노출 키) 사용 금지').toBe(false);
    // RPC 는 호출자 JWT 스코프 클라이언트로 호출(auth.uid/clinic 파생 보존)
    expect(EF_SRC, 'RPC 는 호출자 JWT 스코프 클라이언트로 호출').toContain('callerClient');
  });

  // ═══ S0-CFG: config.toml 에 EF 등록(verify_jwt=true) ═══════════════════════
  test('S0-CFG: config.toml 에 admin-register-staff 함수가 등록됐다(verify_jwt=true)', () => {
    const cfg = readFileSync(path.resolve(__dirname, '../../supabase/config.toml'), 'utf-8');
    const idx = cfg.indexOf('[functions.admin-register-staff]');
    expect(idx, 'config.toml 에 [functions.admin-register-staff] 필요').toBeGreaterThan(-1);
    const block = cfg.slice(idx, idx + 120);
    expect(/verify_jwt\s*=\s*true/.test(block),
      'admin-register-staff 는 실 세션 JWT 요구 → verify_jwt=true').toBe(true);
  });

  // ═══ S1(시나리오 1): 정상 신규 등록(live, self-cleaning) ════════════════════
  test('S1: EF 로 신규 등록 시 봉투 ok:true + auth/profile 짝맞음(자가정리)', async () => {
    const supa = await signedInClient();
    if (!supa) { test.skip(true, 'QA 인증 실패 — 자격정보 미설정'); return; }
    const svc = loadServiceClient();
    if (!svc) { await supa.auth.signOut(); test.skip(true, 'service_role 미설정 — 자가정리 불가로 live 생성 skip'); return; }

    const uniq = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const email = `e2e-provision-${uniq}@obliv-foot.kr`;
    // 임시 자격(하드코딩 아님) — run 고유 uniq 로 조립. 8자↑ + 대/소/숫/특 충족.
    const tmpPw = ['E', 'p', uniq.slice(-4), '!', 'aZ9'].join('');
    const { data: { session } } = await supa.auth.getSession();

    const resp = await supa.functions.invoke('admin-register-staff', {
      body: { email, password: tmpPw, name: '__E2E_PROVISION__', role: 'therapist' },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    test.info().annotations.push({
      type: 's1-ef-result',
      description: `transportErr=${JSON.stringify(resp.error)} body=${JSON.stringify(resp.data)}`,
    });

    // EF 미배포면 transport error → skip (supervisor 배포 후 GREEN)
    if (resp.error && !resp.data) {
      await supa.auth.signOut();
      test.skip(true, `EF 미배포/도달불가 — 배포 후 재실행: ${JSON.stringify(resp.error)}`);
      return;
    }

    const body = resp.data as {
      ok?: boolean; error?: { message?: string } | null;
      data?: { user_id?: string; role?: string; email_confirmed?: boolean; reused_orphan?: boolean };
    };
    try {
      expect(resp.error, 'transport error 없어야 함').toBeFalsy();
      expect(body?.ok, `봉투 ok:true 여야 함(err=${body?.error?.message})`).toBe(true);
      expect(body?.data?.user_id, 'user_id 반환 필요').toBeTruthy();
      // 정확 role 반영(therapist) + 이메일 자동확인(즉시 로그인) 관측
      expect(body?.data?.role, 'role=therapist 정확 반영').toBe('therapist');
      expect(body?.data?.email_confirmed, '신규계정 email 자동확인(true)').toBe(true);

      // 짝맞음: auth.users(id) ↔ user_profiles(id) 존재 + approved=true 관측(원자성)
      const uid = body!.data!.user_id!;
      const { data: prof } = await svc
        .from('user_profiles').select('id, approved, role').eq('id', uid).maybeSingle();
      expect(prof, '등록 후 user_profiles 매핑 존재해야 함(고아 아님)').toBeTruthy();
      expect((prof as { approved?: boolean } | null)?.approved, 'approved=true(승인 완료)').toBe(true);
    } finally {
      // ── 자가정리: staff unlink → profile → auth 순 제거(prod 무오염) ──
      const uid = body?.data?.user_id;
      if (uid) {
        await svc.from('staff').update({ user_id: null }).eq('user_id', uid);
        await svc.from('user_profiles').delete().eq('id', uid);
        await svc.auth.admin.deleteUser(uid).catch(() => {});
      }
      await supa.auth.signOut();
    }
  });

  // ═══ S3(시나리오 2·3 관측): 고아 parity — auth.users ↔ user_profiles 고아 0 ══════
  test('S3: auth.users ↔ user_profiles 고아(orphan) 0 (보상삭제·self-heal 정착 관측)', async () => {
    const svc = loadServiceClient();
    if (!svc) { test.skip(true, 'service_role 미설정 — parity 관측 skip(field-soak 에서 확인)'); return; }

    // 전량 페이지네이션(INV-1 동형) — auth.users 각 행의 user_profiles 매핑 여부.
    const orphans: string[] = [];
    const perPage = 1000;
    for (let page = 1; page <= 100; page++) {
      const { data, error } = await svc.auth.admin.listUsers({ page, perPage });
      if (error) { test.skip(true, `listUsers 실패: ${error.message}`); return; }
      const users = data?.users ?? [];
      for (const u of users) {
        const { data: prof } = await svc.from('user_profiles').select('id').eq('id', u.id).maybeSingle();
        if (!prof) orphans.push(`${u.id} <${u.email ?? '?'}>`);
      }
      if (users.length < perPage) break;
    }

    test.info().annotations.push({
      type: 's3-orphan-scan',
      description: `orphan_count=${orphans.length} sample=${orphans.slice(0, 5).join(', ')}`,
    });

    // 배포순서: EF 배포 → (부모 티켓이 서버경로로 4명 provisioning 이미 해소) → field-soak.
    //   현재 잔존 고아는 배포 전 baseline. 원자화가 정착하면 신규 실패등록이 고아를 만들지 않으므로
    //   ORPHAN_PARITY_ENFORCE=1(supervisor QA) 에서 절대-0 을 강제한다.
    if (process.env.ORPHAN_PARITY_ENFORCE === '1') {
      expect(orphans.length, `고아 auth.users 잔존(원자화 회귀): ${orphans.join(' | ')}`).toBe(0);
    } else {
      console.log(`[S3] baseline orphan_count=${orphans.length} (ORPHAN_PARITY_ENFORCE 미설정 — 배포 후 =0 강제). sample=${orphans.slice(0, 5).join(', ')}`);
      test.skip(true, `배포 전 baseline 관측(orphan=${orphans.length}). 배포 후 ORPHAN_PARITY_ENFORCE=1 로 절대-0 게이트.`);
    }
  });
});
