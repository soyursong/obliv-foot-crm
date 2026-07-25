/**
 * T-20260725-foot-PERMISSION-PARITY-PLAYBOOK
 * 권한 정합 근본수정 플레이북 — 코드가 강제하는 불변식(INV-1~4) 회귀 게이트.
 *
 * 본 spec 은 순수 정적(파일 read + Set 비교)이라 auth/server/DB 불요·결정론적.
 * 플레이북 §0 불변식을 CI 머지 게이트로 고정한다:
 *   INV-1 (패리티 강제)  — role-set 이 여러 곳에 있으면 Set 동등비교로 일치 강제.
 *   INV-2 (server-first) — 권한 마이그가 .DDL_DIFF_HOLD 로 drift 하면 머지 차단(STEP2 스크립트).
 *   INV-4 (닫힌 role 타입) — UserRole 유니온에서 `| string` 개방부 제거(STEP4).
 *   STEP6 (인라인 role=== ratchet) — 신규 인라인 role 판정 추가 차단(STEP6 스크립트).
 *
 * ★STEP1b 핵심: SMS 패턴(FE 배열 ⟷ 대응 배열 Set().toEqual)을 커버 안 됐던
 *   coordinator write 짝으로 확장한다(사고이력 있는 짝 우선).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** `[...'a','b']` 형태 배열 리터럴에서 role 문자열만 추출(SMS 스펙 패턴 재사용). */
function extractRoleArray(src: string, marker: RegExp): string[] {
  const m = src.match(marker);
  if (!m) throw new Error(`role 배열 추출 실패: ${marker}`);
  return [...m[1].matchAll(/'([a-z_]+)'|"([a-z_]+)"/g)].map((x) => x[1] ?? x[2]);
}

const PERMS = 'src/lib/permissions.ts';

// ─────────────────────────────────────────────────────────────────────────────
// INV-4 (STEP4): 닫힌 role 유니온 — `| string` 개방부 제거 회귀 가드.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('INV-4 닫힌 role 타입(STEP4)', () => {
  test('UserRole 유니온에 `| string` 개방부가 없다(닫힌 유니온)', () => {
    const src = read(PERMS);
    const block = src.match(/export type UserRole =([\s\S]*?);/);
    expect(block).not.toBeNull();
    // `| string` (문자열 개방부)이 유니온 본문에 존재하면 unknown role 이 컴파일에서 안 잡힌다.
    expect(/\|\s*string\b/.test(block![1])).toBe(false);
    // 닫힌 유니온에는 실측 role 이 명시되어야 함(대표 표본).
    for (const r of ['admin', 'manager', 'director', 'coordinator', 'therapist', 'tm']) {
      expect(block![1]).toContain(`'${r}'`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-1 (STEP1b): coordinator write 짝 패리티 — FE role-set ⟷ RLS effective set 동등.
//   staff 로스터 write RLS effective set =
//     base(staff_admin_all = is_admin_or_manager = admin/manager/director)
//     ∪ coordinator(staff_coordinator_*_staffcrud ADDITIVE 정책)
//   이 값이 FE STAFF_CRUD_ROLES 와 Set 동등이어야 한다(불일치 = lock-out-in-disguise 재발).
// ─────────────────────────────────────────────────────────────────────────────
test.describe('INV-1 coordinator write 패리티(STEP1b)', () => {
  const CRUD_MIG =
    'supabase/migrations/20260630220000_staff_coordinator_crud_rls_additive.sql';

  test('FE STAFF_CRUD_ROLES = RLS effective write-set (Set 동등)', () => {
    const perms = read(PERMS);
    const feSet = new Set(
      extractRoleArray(perms, /STAFF_CRUD_ROLES:\s*UserRole\[\]\s*=\s*\[([^\]]+)\]/),
    );

    // RLS base: staff_admin_all = is_admin_or_manager() = {admin, manager, director}.
    const rlsBase = ['admin', 'manager', 'director'];

    // RLS additive: coordinator crud 마이그가 부여하는 role(=coordinator) 실측 추출.
    const mig = read(CRUD_MIG);
    const coordRoles = [
      ...mig.matchAll(/current_user_role\(\)\s*=\s*'([a-z_]+)'/g),
    ].map((x) => x[1]);
    expect(coordRoles.length).toBeGreaterThan(0); // 마이그가 실제 role 을 부여
    const rlsEffective = new Set([...rlsBase, ...coordRoles]);

    // ★핵심 동등비교: FE 게이트 집합 == RLS effective write 집합.
    expect(feSet).toEqual(rlsEffective);
    // coordinator 가 양쪽 모두에 실재(사고이력 짝)
    expect(feSet.has('coordinator')).toBe(true);
    expect(rlsEffective.has('coordinator')).toBe(true);
  });

  test('coordinator RLS 는 권한상승 가드(role<>director)를 서버측에 유지', () => {
    const mig = read(CRUD_MIG);
    // guard1: coordinator 는 director 로스터 생성/수정 불가 — WITH CHECK/USING 에 role<>'director'.
    expect(/role\s*<>\s*'director'/.test(mig)).toBe(true);
    // ADDITIVE only: 기존 staff_admin_all 정책 DROP/ALTER 금지(무회귀).
    expect(mig).not.toContain('DROP POLICY IF EXISTS staff_admin_all');
    expect(/ALTER\s+POLICY\s+staff_admin_all/i.test(mig)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-1 재확인: manual_sms_send FE ⟷ EF 패리티(기존 SMS 스펙 커버, 이중 가드).
// ─────────────────────────────────────────────────────────────────────────────
test.describe('INV-1 manual_sms_send FE⟷EF 패리티(재확인)', () => {
  test('permissions.ts ALL_STAFF_ROLES = send-notification EF MANUAL_SEND_ALLOWED_ROLES', () => {
    const fe = new Set(
      extractRoleArray(read(PERMS), /ALL_STAFF_ROLES:\s*UserRole\[\]\s*=\s*\[([^\]]+)\]/),
    );
    const ef = new Set(
      extractRoleArray(
        read('supabase/functions/send-notification/index.ts'),
        /MANUAL_SEND_ALLOWED_ROLES\s*=\s*\[([^\]]+)\]/,
      ),
    );
    expect(fe).toEqual(ef);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP1a / INV-2 / STEP6: 게이트 배선 회귀 가드 — CI/스크립트가 조용히 빠지지 않도록.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('게이트 배선(STEP1a/INV-2/STEP6)', () => {
  test('ci-push.yml 에 perm-parity job 이 배선되어 있다', () => {
    const ci = read('.github/workflows/ci-push.yml');
    expect(ci).toContain('perm-parity');
    expect(ci).toContain('check-perm-migration-hold.sh'); // STEP2
    expect(ci).toContain('check-inline-role-ratchet.sh'); // STEP6
    expect(ci).toContain('test:perm-parity');             // STEP1
  });

  test('STEP2/STEP6 게이트 스크립트 + baseline 이 실재한다', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'scripts/check-perm-migration-hold.sh'))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, 'scripts/check-inline-role-ratchet.sh'))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, 'scripts/.inline-role-baseline'))).toBe(true);
  });

  test('package.json 에 test:perm-parity 스크립트가 있다', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['test:perm-parity']).toBeTruthy();
  });
});
