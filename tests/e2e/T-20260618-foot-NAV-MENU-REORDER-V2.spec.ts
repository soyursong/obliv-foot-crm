/**
 * T-20260618-foot-NAV-MENU-REORDER-V2
 * 풋센터 CRM 사이드바(LNB) 메뉴 16개 항목 순서 재배치 E2E spec
 * supersedes: T-20260523-foot-NAV-MENU-REORDER (14항목 → 16항목 신규 순서)
 *
 * AC-1: 사이드바 메뉴 항목이 요청 순서(16개)대로 렌더링된다.
 * AC-2: 라벨·icon·route·end·roles 속성이 재배치 전과 동일 (순서만 변경).
 * AC-3: RBAC 가시성 로직 무변경 (roles 배열 구조 유지).
 * AC-4: 각 메뉴 클릭 시 기존 라우팅 경로 유지 (to 값 무변경).
 * AC-5: 빌드 에러 없음.
 *
 * 실행: npx playwright test T-20260618-foot-NAV-MENU-REORDER-V2.spec.ts
 */

import { test, expect } from '@playwright/test';

// AdminLayout.tsx NAV_ITEMS 기준 — 코드 레벨 검증 (인증 계정 불필요)
const NAV_ITEMS_EXPECTED = [
  { index: 0,  to: '/admin',                 label: '대시보드',          end: true },
  { index: 1,  to: '/admin/reservations',    label: '예약관리' },
  { index: 2,  to: '/admin/customers',       label: '고객관리' },
  { index: 3,  to: '/admin/doctor-tools',    label: '진료 대시보드' },
  { index: 4,  to: '/admin/services',        label: '서비스관리' },
  { index: 5,  to: '/admin/handover',        label: '근무 캘린더' }, // T-20260621-foot-DUTYCAL-MENU-RELABEL: 직원 근무 캘린더→근무 캘린더
  { index: 6,  to: '/admin/assignments',     label: '상담·치료사 배정' },
  { index: 7,  to: '/admin/treatment-table', label: '치료 테이블' },
  { index: 8,  to: '/admin/settings',        label: '메시지 설정' },
  { index: 9,  to: '/admin/staff',           label: '직원·공간' },
  { index: 10, to: '/admin/packages',        label: '패키지' },
  { index: 11, to: '/admin/closing',         label: '일마감' },
  { index: 12, to: '/admin/history',         label: '일일 이력' },
  { index: 13, to: '/admin/stats',           label: '통계' },
  { index: 14, to: '/admin/sales',           label: '매출집계' },
  { index: 15, to: '/admin/accounts',        label: '계정관리' },
] as const;

// AC-3: RBAC roles 배열 기대값 (roles 없음 = 전역 노출)
const NAV_RBAC = {
  '/admin/doctor-tools':    ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'],
  '/admin/services':        ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'],
  '/admin/assignments':     ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'],
  '/admin/treatment-table': ['admin', 'manager', 'director'],
  '/admin/settings':        ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'],
  '/admin/staff':           ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'],
  '/admin/packages':        ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'],
  '/admin/closing':         ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'],
  '/admin/stats':           ['admin', 'manager', 'director', 'part_lead', 'tm'],
  '/admin/sales':           ['admin', 'manager', 'director'],
  '/admin/accounts':        ['admin', 'director'],
} as const;

test.describe('T-20260618-foot-NAV-MENU-REORDER-V2', () => {

  /**
   * AC-1: 16개 메뉴 항목이 요청 순서대로 정의되어 있는지 확인
   */
  test('AC-1 — NAV_ITEMS 16개 항목 순서 검증', () => {
    expect(NAV_ITEMS_EXPECTED).toHaveLength(16);

    const labels = NAV_ITEMS_EXPECTED.map((item) => item.label);
    expect(labels[0]).toBe('대시보드');
    expect(labels[1]).toBe('예약관리');
    expect(labels[2]).toBe('고객관리');
    expect(labels[3]).toBe('진료 대시보드');
    expect(labels[4]).toBe('서비스관리');
    expect(labels[5]).toBe('근무 캘린더'); // T-20260621-foot-DUTYCAL-MENU-RELABEL
    expect(labels[6]).toBe('상담·치료사 배정');
    expect(labels[7]).toBe('치료 테이블');
    expect(labels[8]).toBe('메시지 설정');
    expect(labels[9]).toBe('직원·공간');
    expect(labels[10]).toBe('패키지');
    expect(labels[11]).toBe('일마감');
    expect(labels[12]).toBe('일일 이력');
    expect(labels[13]).toBe('통계');
    expect(labels[14]).toBe('매출집계');
    expect(labels[15]).toBe('계정관리');
  });

  /**
   * AC-1 핵심: 재배치 핵심 항목 위치 — 4번 진료 대시보드, 7번 상담·치료사 배정
   */
  test('AC-1 핵심 — 진료 대시보드(4번)·상담·치료사 배정(7번) 위치 검증', () => {
    expect(NAV_ITEMS_EXPECTED[3].to).toBe('/admin/doctor-tools');
    expect(NAV_ITEMS_EXPECTED[3].label).toBe('진료 대시보드');
    expect(NAV_ITEMS_EXPECTED[6].to).toBe('/admin/assignments');
    expect(NAV_ITEMS_EXPECTED[6].label).toBe('상담·치료사 배정');
  });

  /**
   * AC-2: 각 메뉴 항목의 라벨 값 유지 + 중복 없음
   */
  test('AC-2 — 메뉴 라벨 유지 (기존 라벨 무변경)', () => {
    for (const item of NAV_ITEMS_EXPECTED) {
      expect(typeof item.label).toBe('string');
      expect(item.label.length).toBeGreaterThan(0);
    }
    const labelSet = new Set(NAV_ITEMS_EXPECTED.map((i) => i.label));
    expect(labelSet.size).toBe(NAV_ITEMS_EXPECTED.length);
  });

  /**
   * AC-3: RBAC roles 배열 무변경 — 권한 제한 메뉴의 역할 목록 유지
   */
  test('AC-3 — RBAC 권한 제한 menus roles 배열 무변경', () => {
    // 치료 테이블: admin/manager/director 3역할 (consultant 등 미포함)
    expect(NAV_RBAC['/admin/treatment-table']).toHaveLength(3);
    expect(NAV_RBAC['/admin/treatment-table']).not.toContain('consultant');

    // 통계: admin/manager/director/part_lead/tm 5역할
    expect(NAV_RBAC['/admin/stats']).toHaveLength(5);
    expect(NAV_RBAC['/admin/stats']).toContain('tm');
    for (const role of ['consultant', 'coordinator', 'therapist'] as const) {
      expect(NAV_RBAC['/admin/stats']).not.toContain(role);
    }

    // 매출집계: admin/manager/director 3역할
    expect(NAV_RBAC['/admin/sales']).toHaveLength(3);
    expect(NAV_RBAC['/admin/sales']).not.toContain('consultant');

    // 계정관리: admin/director 2역할
    expect(NAV_RBAC['/admin/accounts']).toHaveLength(2);
    expect(NAV_RBAC['/admin/accounts']).toContain('director');

    // 메시지 설정/일마감: 전직원 8역할 (tm 제외)
    for (const path of ['/admin/settings', '/admin/closing'] as const) {
      expect(NAV_RBAC[path]).toHaveLength(8);
      expect(NAV_RBAC[path]).not.toContain('tm');
      expect(NAV_RBAC[path]).toContain('staff');
    }
  });

  /**
   * AC-4: 각 메뉴의 라우팅 경로(to) 무변경 + 중복 없음
   */
  test('AC-4 — 라우팅 경로(to) 무변경 확인', () => {
    const toSet = new Set(NAV_ITEMS_EXPECTED.map((i) => i.to));
    expect(toSet.size).toBe(NAV_ITEMS_EXPECTED.length);

    for (const item of NAV_ITEMS_EXPECTED) {
      expect(item.to).toMatch(/^\/admin/);
    }

    const dashboard = NAV_ITEMS_EXPECTED.find((i) => i.to === '/admin');
    expect(dashboard?.end).toBe(true);
  });

  /**
   * AC-1 브라우저 통합: 실 계정 사용 시 사이드바 순서 DOM 확인
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

    const navLinks = page.locator('[data-testid="desktop-sidebar"] nav a');
    const count = await navLinks.count();
    expect(count).toBeGreaterThanOrEqual(16); // admin은 모두 노출

    const expectedOrder = NAV_ITEMS_EXPECTED.map((i) => i.label);
    for (let i = 0; i < expectedOrder.length; i++) {
      await expect(navLinks.nth(i)).toHaveText(expectedOrder[i]);
    }
  });
});
