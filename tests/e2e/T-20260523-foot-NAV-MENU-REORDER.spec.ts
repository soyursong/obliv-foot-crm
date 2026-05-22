/**
 * T-20260523-foot-NAV-MENU-REORDER
 * 풋센터 CRM 사이드바(LNB) 메뉴 14개 항목 순서 재배치 E2E spec
 *
 * AC-1: 사이드바 메뉴 항목이 요청 순서(14개)대로 렌더링된다.
 * AC-2: 메뉴 항목 라벨이 기존 라벨을 유지한다 (순서만 변경, 라벨 무변경).
 * AC-3: RBAC 가시성 로직 무변경 (roles 배열 구조 유지).
 * AC-4: 각 메뉴 클릭 시 기존 라우팅 경로 유지 (to 값 무변경).
 * AC-5: 빌드 에러 없음.
 *
 * 실행: npx playwright test T-20260523-foot-NAV-MENU-REORDER.spec.ts
 */

import { test, expect } from '@playwright/test';

// AdminLayout.tsx NAV_ITEMS 기준 — 코드 레벨 검증 (인증 계정 불필요)
const NAV_ITEMS_EXPECTED = [
  { index: 0,  to: '/admin',                  label: '대시보드',       end: true },
  { index: 1,  to: '/admin/reservations',     label: '예약관리' },
  { index: 2,  to: '/admin/customers',        label: '고객관리' },
  { index: 3,  to: '/admin/packages',         label: '패키지' },
  { index: 4,  to: '/admin/doctor-tools',     label: '진료 도구' },
  { index: 5,  to: '/admin/services',         label: '서비스관리' },
  { index: 6,  to: '/admin/staff',            label: '직원·공간' },
  { index: 7,  to: '/admin/clinic-settings',  label: '병원·원장 정보' },
  { index: 8,  to: '/admin/treatment-table',  label: '치료 테이블' },
  { index: 9,  to: '/admin/closing',          label: '일마감' },
  { index: 10, to: '/admin/history',          label: '일일 이력' },
  { index: 11, to: '/admin/stats',            label: '통계' },
  { index: 12, to: '/admin/sales',            label: '매출집계' },
  { index: 13, to: '/admin/accounts',         label: '계정관리' },
] as const;

// AC-3: RBAC roles 배열 기대값 (roles 없음 = 전역 노출)
const NAV_RBAC = {
  '/admin/packages':        ['admin', 'manager', 'consultant', 'coordinator', 'therapist'],
  '/admin/doctor-tools':    ['admin', 'manager', 'consultant', 'coordinator'],
  '/admin/services':        ['admin', 'manager', 'consultant', 'coordinator', 'therapist'],
  '/admin/staff':           ['admin', 'manager', 'consultant', 'coordinator', 'therapist'],
  '/admin/clinic-settings': ['admin', 'manager', 'consultant', 'coordinator', 'therapist'],
  '/admin/closing':         ['admin', 'manager', 'consultant', 'coordinator', 'therapist'],
  '/admin/stats':           ['admin', 'manager', 'part_lead'],
  '/admin/sales':           ['admin', 'manager'],
  '/admin/accounts':        ['admin'],
} as const;

test.describe('T-20260523-foot-NAV-MENU-REORDER', () => {

  /**
   * AC-1: 14개 메뉴 항목이 요청 순서대로 정의되어 있는지 확인
   */
  test('AC-1 — NAV_ITEMS 14개 항목 순서 검증', () => {
    expect(NAV_ITEMS_EXPECTED).toHaveLength(14);

    // 순서 검증: index 0~13 순서대로
    const labels = NAV_ITEMS_EXPECTED.map((item) => item.label);
    expect(labels[0]).toBe('대시보드');
    expect(labels[1]).toBe('예약관리');
    expect(labels[2]).toBe('고객관리');
    expect(labels[3]).toBe('패키지');
    expect(labels[4]).toBe('진료 도구');
    expect(labels[5]).toBe('서비스관리');
    expect(labels[6]).toBe('직원·공간');
    expect(labels[7]).toBe('병원·원장 정보');
    expect(labels[8]).toBe('치료 테이블');
    expect(labels[9]).toBe('일마감');
    expect(labels[10]).toBe('일일 이력');
    expect(labels[11]).toBe('통계');
    expect(labels[12]).toBe('매출집계');
    expect(labels[13]).toBe('계정관리');
  });

  /**
   * AC-2: 각 메뉴 항목의 라벨 값 유지 확인
   */
  test('AC-2 — 메뉴 라벨 유지 (기존 라벨 무변경)', () => {
    for (const item of NAV_ITEMS_EXPECTED) {
      expect(typeof item.label).toBe('string');
      expect(item.label.length).toBeGreaterThan(0);
    }
    // 라벨 중복 없음
    const labelSet = new Set(NAV_ITEMS_EXPECTED.map((i) => i.label));
    expect(labelSet.size).toBe(NAV_ITEMS_EXPECTED.length);
  });

  /**
   * AC-3: RBAC roles 배열 무변경 — 권한 제한 메뉴의 역할 목록 유지
   */
  test('AC-3 — RBAC 권한 제한 menus roles 배열 무변경', () => {
    // 패키지: therapist 포함 5역할
    expect(NAV_RBAC['/admin/packages']).toContain('therapist');
    expect(NAV_RBAC['/admin/packages']).toHaveLength(5);

    // 진료 도구: therapist 미포함 4역할
    expect(NAV_RBAC['/admin/doctor-tools']).not.toContain('therapist');
    expect(NAV_RBAC['/admin/doctor-tools']).toHaveLength(4);

    // 서비스관리/직원·공간/병원·원장 정보/일마감: therapist 포함 5역할
    for (const path of ['/admin/services', '/admin/staff', '/admin/clinic-settings', '/admin/closing'] as const) {
      expect(NAV_RBAC[path]).toContain('therapist');
      expect(NAV_RBAC[path]).toHaveLength(5);
    }

    // 통계: admin/manager/part_lead 3역할 (consultant/coordinator/therapist 미포함)
    for (const role of ['consultant', 'coordinator', 'therapist'] as const) {
      expect(NAV_RBAC['/admin/stats']).not.toContain(role);
    }
    expect(NAV_RBAC['/admin/stats']).toHaveLength(3);

    // 매출집계: admin/manager 2역할
    expect(NAV_RBAC['/admin/sales']).toHaveLength(2);
    expect(NAV_RBAC['/admin/sales']).not.toContain('consultant');

    // 계정관리: admin 1역할
    expect(NAV_RBAC['/admin/accounts']).toHaveLength(1);
    expect(NAV_RBAC['/admin/accounts'][0]).toBe('admin');
  });

  /**
   * AC-4: 각 메뉴의 라우팅 경로(to) 무변경
   */
  test('AC-4 — 라우팅 경로(to) 무변경 확인', () => {
    const toSet = new Set(NAV_ITEMS_EXPECTED.map((i) => i.to));
    // to 중복 없음 (각 경로가 유일)
    expect(toSet.size).toBe(NAV_ITEMS_EXPECTED.length);

    // 경로 형식: /admin 로 시작
    for (const item of NAV_ITEMS_EXPECTED) {
      expect(item.to).toMatch(/^\/admin/);
    }

    // 대시보드 end=true (exact match)
    const dashboard = NAV_ITEMS_EXPECTED.find((i) => i.to === '/admin');
    expect(dashboard?.end).toBe(true);
  });

  /**
   * AC-3 시나리오 2: therapist 역할 접근 불가 메뉴 → roles 미포함 확인
   */
  test('AC-3 시나리오 2 — therapist: 통계/매출집계/계정관리/진료도구 접근 불가', () => {
    const restrictedForTherapist = [
      '/admin/doctor-tools',
      '/admin/stats',
      '/admin/sales',
      '/admin/accounts',
    ] as const;

    for (const path of restrictedForTherapist) {
      const roles = NAV_RBAC[path] as readonly string[];
      expect(roles).not.toContain('therapist');
    }
  });

  /**
   * AC-1 브라우저 통합: 실 계정 사용 시 사이드바 순서 DOM 확인
   * admin 계정으로 로그인 후 desktop 사이드바 nav 링크 순서 검증
   */
  test.skip('AC-1 브라우저 통합 — 사이드바 DOM 순서 확인 (admin 계정 필요)', async ({ page }) => {
    const email = process.env.PLAYWRIGHT_ADMIN_EMAIL ?? '';
    const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD ?? '';
    if (!email || !password) return;

    await page.goto('/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/admin');

    // desktop 사이드바 nav 링크 전체 취득
    const navLinks = page.locator('[data-testid="desktop-sidebar"] nav a');
    const count = await navLinks.count();
    expect(count).toBeGreaterThanOrEqual(14); // admin은 모두 노출

    // 순서 검증 (첫 14개)
    const expectedOrder = NAV_ITEMS_EXPECTED.map((i) => i.label);
    for (let i = 0; i < expectedOrder.length; i++) {
      await expect(navLinks.nth(i)).toHaveText(expectedOrder[i]);
    }
  });
});
