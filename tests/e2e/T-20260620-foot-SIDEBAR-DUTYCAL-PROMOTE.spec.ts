/**
 * T-20260620-foot-SIDEBAR-DUTYCAL-PROMOTE
 * 원장님 근무 캘린더(듀티 로스터)를 사이드바 최상위 [직원 근무 캘린더](/admin/handover)로
 * 승격·흡수 — 스케줄 관리 동선 1곳 일원화. UI 네비게이션만, DB 변경 없음.
 *
 * 구현 결정: 최상위 [직원 근무 캘린더] 메뉴(/admin/handover, 기존 인수인계 게시판)에
 *   '원장 근무표' 탭을 흡수. 기존 직원·공간(Staff.tsx)의 '근무캘린더' 탭은 제거(중복 노출 방지).
 *
 * AC-1: 최상위 [직원 근무 캘린더] 메뉴(/admin/handover) 존재 + DutyRosterTab 흡수(탭 렌더).
 * AC-2: 직원·공간의 '근무캘린더'(duty) 탭 제거 — TabsTrigger/TabsContent/import/기본탭 정리. 다른 탭 유지.
 * AC-3: 흡수된 원장 근무표 탭은 이동 전 직원·공간 노출 role(6역할)로 게이트 — part_lead/staff/tm 신규 노출 금지.
 * AC-4: 네비게이션 무결성 — handover route(/admin/handover) 무변경, 다른 메뉴 영향 없음.
 *
 * 코드 레벨 검증(인증 계정 불필요) + 브라우저 통합 skip.
 * 실행: npx playwright test T-20260620-foot-SIDEBAR-DUTYCAL-PROMOTE.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ESM scope: __dirname 미정의 → playwright 는 repo root 에서 실행되므로 cwd 기준 src 사용.
const SRC = resolve(process.cwd(), 'src');
const handoverSrc = readFileSync(resolve(SRC, 'pages/Handover.tsx'), 'utf-8');
const staffSrc = readFileSync(resolve(SRC, 'pages/Staff.tsx'), 'utf-8');
const adminLayoutSrc = readFileSync(resolve(SRC, 'components/AdminLayout.tsx'), 'utf-8');

// 이동 전 원장 근무표(DutyRosterTab) 노출 = 직원·공간 메뉴 role 집합
const DUTY_ROSTER_ROLES = ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'];
// 새로 노출되면 안 되는 role (이동 전 직원·공간 메뉴에서 보이지 않던 role)
const NEWLY_FORBIDDEN_ROLES = ['part_lead', 'staff', 'tm'];

test.describe('T-20260620-foot-SIDEBAR-DUTYCAL-PROMOTE', () => {

  /**
   * AC-1: 최상위 [직원 근무 캘린더] 메뉴(/admin/handover)가 사이드바 최상위에 존재.
   */
  test('AC-1 — 최상위 [직원 근무 캘린더] 메뉴(/admin/handover) 존재', () => {
    expect(adminLayoutSrc).toMatch(/to:\s*'\/admin\/handover',\s*label:\s*'직원 근무 캘린더'/);
  });

  /**
   * AC-1: 원장 근무표(DutyRosterTab)가 Handover 페이지로 흡수되어 렌더된다.
   */
  test('AC-1 — DutyRosterTab 흡수 (Handover.tsx 에서 import·렌더)', () => {
    expect(handoverSrc).toContain("import { DutyRosterTab } from '@/components/DutyRosterTab'");
    expect(handoverSrc).toContain('<DutyRosterTab clinic={clinic} />');
    // 상단 탭 스트립 + 원장 근무표 탭 트리거 존재
    expect(handoverSrc).toContain('data-testid="handover-tab-duty"');
    expect(handoverSrc).toContain('원장 근무표');
    expect(handoverSrc).toContain('data-testid="handover-duty-pane"');
  });

  /**
   * AC-2: 직원·공간(Staff.tsx)의 '근무캘린더'(duty) 탭이 제거됨.
   */
  test('AC-2 — 직원·공간 duty 탭 제거 (흡수로 중복 제거)', () => {
    // duty TabsTrigger / TabsContent 미존재
    expect(staffSrc).not.toContain('<TabsTrigger value="duty">');
    expect(staffSrc).not.toContain('<TabsContent value="duty">');
    // 근무캘린더 라벨 트리거 제거 (코멘트 외 실제 트리거 텍스트 없음)
    expect(staffSrc).not.toMatch(/<TabsTrigger value="duty">[\s\S]*?근무캘린더/);
    // DutyRosterTab import 제거
    expect(staffSrc).not.toContain("import { DutyRosterTab } from '@/components/DutyRosterTab'");
    // 기본 탭 duty → staff
    expect(staffSrc).toMatch(/VALID_INITIAL_TABS\.has\(requestedTab\)\s*\?\s*requestedTab\s*:\s*'staff'/);
    // VALID_INITIAL_TABS 에서 'duty' 제거
    const validSetMatch = staffSrc.match(/VALID_INITIAL_TABS = new Set\(\[([^\]]*)\]\)/);
    expect(validSetMatch).not.toBeNull();
    expect(validSetMatch![1]).not.toContain("'duty'");
  });

  /**
   * AC-2: 같은 영역(직원·공간) 다른 탭은 유지된다.
   */
  test('AC-2 — 직원·공간 다른 탭(직원/공간 배정/원장정보) 유지', () => {
    expect(staffSrc).toContain('<TabsTrigger value="staff">');
    expect(staffSrc).toContain('<TabsTrigger value="rooms">');
    expect(staffSrc).toContain('<TabsTrigger value="clinic-info">');
    expect(staffSrc).toContain('<TabsContent value="staff">');
    expect(staffSrc).toContain('<TabsContent value="rooms">');
  });

  /**
   * AC-3: 흡수된 원장 근무표 탭은 이동 전 role(6역할)로 게이트.
   *        part_lead/staff/tm 에게 새로 노출되지 않아야 함(STAFF-PERM-UNLOCK-6MENU 충돌 방지).
   */
  test('AC-3 — 권한 가드 보존: 원장 근무표 탭 role 게이트(6역할)', () => {
    // DUTY_ROSTER_ROLES 정의 + canSeeDutyRoster 게이트 존재
    const rolesMatch = handoverSrc.match(/DUTY_ROSTER_ROLES\s*=\s*\[([^\]]*)\]/);
    expect(rolesMatch).not.toBeNull();
    const rolesLiteral = rolesMatch![1];
    for (const role of DUTY_ROSTER_ROLES) {
      expect(rolesLiteral).toContain(`'${role}'`);
    }
    for (const role of NEWLY_FORBIDDEN_ROLES) {
      expect(rolesLiteral).not.toContain(`'${role}'`);
    }
    // 탭/패인 렌더가 canSeeDutyRoster 게이트 뒤에 있음
    expect(handoverSrc).toContain('canSeeDutyRoster');
    expect(handoverSrc).toMatch(/canSeeDutyRoster && topTab === 'duty'/);
  });

  /**
   * AC-4: 네비게이션 무결성 — handover route(/admin/handover) 무변경.
   *        AdminLayout NAV_ITEMS 의 /admin/staff role 집합은 그대로(6역할).
   */
  test('AC-4 — 네비게이션 무결성 (handover route·staff role 무변경)', () => {
    // handover 라우트는 그대로(라벨 유지)
    expect(adminLayoutSrc).toContain("to: '/admin/handover'");
    // /admin/staff nav roles = 6역할 (DUTY_ROSTER_ROLES 와 동일 = AC-3 SSOT 패리티)
    const staffNavMatch = adminLayoutSrc.match(
      /to:\s*'\/admin\/staff',\s*label:\s*'직원·공간',\s*icon:\s*\w+,\s*roles:\s*\[([^\]]*)\]/,
    );
    expect(staffNavMatch).not.toBeNull();
    for (const role of DUTY_ROSTER_ROLES) {
      expect(staffNavMatch![1]).toContain(`'${role}'`);
    }
  });

  /**
   * AC-1 브라우저 통합 (admin 계정 필요 — 평소 skip): 최상위 메뉴 진입 → 원장 근무표 탭 표시.
   */
  test.skip('AC-1 브라우저 통합 — [직원 근무 캘린더] 진입 후 원장 근무표 탭 (admin 계정 필요)', async ({ page }) => {
    const email = process.env.PLAYWRIGHT_ADMIN_EMAIL ?? '';
    const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD ?? '';
    if (!email || !password) return;

    await page.goto('/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/admin');

    // 최상위 [직원 근무 캘린더] 메뉴 진입
    await page.goto('/admin/handover');
    await expect(page.getByTestId('handover-top-tabs')).toBeVisible();
    // 원장 근무표 탭 클릭 → DutyRosterTab pane 표시
    await page.getByTestId('handover-tab-duty').click();
    await expect(page.getByTestId('handover-duty-pane')).toBeVisible();
  });
});
