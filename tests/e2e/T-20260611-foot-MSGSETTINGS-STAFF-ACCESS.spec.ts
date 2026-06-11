/**
 * T-20260611-foot-MSGSETTINGS-STAFF-ACCESS
 * 메시지 설정(/admin/settings) 직원(staff/part_lead) 개방.
 *
 * 배경(RC): App.tsx settings RoleGuard + permissions.ts PERM_MATRIX.messaging 가
 *   staff/part_lead 미포함 → 직원이 '메시지 설정' 진입 시 대시보드 리다이렉트.
 *   부모: RLS-MENU-ROLE-PARITY-POLICY open-all-except-3 의 OPEN 케이스 집행.
 *
 * 수정(FE-only, DB무접촉): 동일 집합 SSOT 3곳을 전직원(8역할, tm 제외)으로 정렬.
 *   1) permissions.ts  PERM_MATRIX.messaging       = [...ALL_STAFF_ROLES]
 *   2) App.tsx         settings RoleGuard roles      = 8역할 명시
 *   3) AdminLayout.tsx '메시지 설정' NAV_ITEMS.roles = 8역할 명시 (메뉴=라우트 패리티)
 *
 * ★tm 제외 보존★: 박민지 팀장 C안(AC6, STAFF-ROLE-TM-ADD) tm=4메뉴 최소권한 고정.
 *   tm 이 messaging/settings 에 들어가면 qa-fail.
 *
 * 누수 0 검증: AdminSettings ⓪연결설정(Solapi 자격증명)=adminOnly 내부게이팅,
 *   ⑦QR=mgrPlus. 계정관리/통계/매출은 별도 라우트 → staff route 개방해도 누수 없음.
 *
 * role 매트릭스/RoleGuard/nav 가 전부 소스 상수 → 정적 소스 검증(fs.readFileSync)으로
 *   AC1~AC5 회귀를 잡는다. 브라우저 auth 불필요 → 빠르고 견고.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** marker 정규식의 1번 캡처그룹(배열 내부)에서 role 토큰 추출 */
function extractRoleArray(src: string, marker: RegExp): string[] {
  const m = src.match(marker);
  if (!m) throw new Error(`배열 추출 실패: ${marker}`);
  return [...m[1].matchAll(/'([a-z_]+)'|"([a-z_]+)"/g)].map((x) => x[1] ?? x[2]);
}

const STAFF_8 = [
  'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff',
];

// ── AC1: permissions.ts PERM_MATRIX.messaging = 전직원(ALL_STAFF_ROLES, tm 제외) ──
test('AC1 PERM_MATRIX.messaging 에 staff/part_lead 포함 + tm 미포함', () => {
  const src = read('src/lib/permissions.ts');

  // ALL_STAFF_ROLES = 8역할(tm 미포함) 불변식
  const allStaff = extractRoleArray(src, /ALL_STAFF_ROLES:\s*UserRole\[\]\s*=\s*\[([^\]]+)\]/);
  expect(allStaff.sort()).toEqual([...STAFF_8].sort());
  expect(allStaff).not.toContain('tm');

  // messaging 은 [...ALL_STAFF_ROLES] (= 8역할) — staff/part_lead 포함, tm 제외
  expect(src).toMatch(/messaging:\s*\[\.\.\.ALL_STAFF_ROLES\]/);

  // 런타임 의미 검증: canAccess 시뮬레이션
  const messagingRoles = [...allStaff]; // [...ALL_STAFF_ROLES]
  expect(messagingRoles).toContain('staff');
  expect(messagingRoles).toContain('part_lead');
  expect(messagingRoles).not.toContain('tm');
});

// ── AC2: App.tsx settings RoleGuard 에 staff/part_lead 포함, tm 미포함 ────────────
test('AC2 App.tsx settings RoleGuard roles 에 staff/part_lead 포함 + tm 미포함', () => {
  const app = read('src/App.tsx');
  const roles = extractRoleArray(
    app,
    /path="settings"\s+element=\{<RoleGuard roles=\{\[([^\]]+)\]\}/,
  );
  expect(roles).toContain('staff');
  expect(roles).toContain('part_lead');
  expect(roles).not.toContain('tm');
  expect(roles.sort()).toEqual([...STAFF_8].sort());
});

// ── AC3: AdminLayout '메시지 설정' nav roles 패리티 (메뉴=라우트) ─────────────────
test('AC3 AdminLayout 메시지 설정 NAV_ITEMS roles 에 staff/part_lead 포함 + tm 미포함', () => {
  const layout = read('src/components/AdminLayout.tsx');
  const navRoles = extractRoleArray(
    layout,
    /to:\s*'\/admin\/settings'[^}]*roles:\s*\[([^\]]+)\]/,
  );
  expect(navRoles).toContain('staff');
  expect(navRoles).toContain('part_lead');
  expect(navRoles).not.toContain('tm');
  expect(navRoles.sort()).toEqual([...STAFF_8].sort());
});

// ── AC4: 3-way SSOT 정합 — messaging(PERM) ≡ settings RoleGuard ≡ nav ────────────
test('AC4 3곳(PERM_MATRIX.messaging / App settings RoleGuard / AdminLayout nav) 동일 집합', () => {
  const perm = read('src/lib/permissions.ts');
  const app = read('src/App.tsx');
  const layout = read('src/components/AdminLayout.tsx');

  const allStaff = extractRoleArray(perm, /ALL_STAFF_ROLES:\s*UserRole\[\]\s*=\s*\[([^\]]+)\]/);
  const settingsRoles = extractRoleArray(
    app, /path="settings"\s+element=\{<RoleGuard roles=\{\[([^\]]+)\]\}/,
  ).sort();
  const navRoles = extractRoleArray(
    layout, /to:\s*'\/admin\/settings'[^}]*roles:\s*\[([^\]]+)\]/,
  ).sort();

  // messaging = [...ALL_STAFF_ROLES] → 의미상 allStaff 와 동일
  expect(settingsRoles).toEqual([...allStaff].sort());
  expect(navRoles).toEqual([...allStaff].sort());
  expect(settingsRoles).toEqual(navRoles);
});

// ── AC5: 누수 0 — AdminSettings ⓪연결설정 adminOnly 내부게이팅 보존 ───────────────
test('AC5 AdminSettings ⓪연결설정(Solapi)=adminOnly, 섹션 필터가 adminOnly/mgrPlus 게이팅', () => {
  const settings = read('src/pages/AdminSettings.tsx');

  // ⓪연결설정 = adminOnly:true (Solapi 자격증명)
  expect(settings).toMatch(/id:\s*'0_connection'[^}]*adminOnly:\s*true/);

  // 섹션 가시성 필터가 adminOnly→isAdmin, mgrPlus→admin|manager 로 게이팅
  expect(settings).toMatch(/!s\.adminOnly\s*\|\|\s*isAdmin/);
  expect(settings).toMatch(/!s\.mgrPlus\s*\|\|\s*isAdmin\s*\|\|\s*isManager/);

  // 렌더 단계 이중 게이팅: 0_connection 은 isAdmin 일 때만 렌더
  expect(settings).toMatch(/activeSection === '0_connection'\s*&&\s*isAdmin/);
});
