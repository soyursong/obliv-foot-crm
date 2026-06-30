/**
 * T-20260629-foot-HANDOVER-TAB-MERGE-SCROLL
 * 근무 캘린더(/admin/handover) 의사·직원 2탭 → 단일 스크롤 뷰 통합.
 *
 *   상단 섹션 : DutyRosterTab(의사/원장 근무표) — 권한가드 DUTY_ROSTER_ROLES 보존
 *   구분선    : 두 섹션 사이 divider
 *   하단 섹션 : 인수인계 게시판(직원 캘린더) — 기존 그대로
 *   Tabs/TabsList/TabsTrigger·topTab/setTopTab 제거.
 *   data-testid handover-tab-board / handover-tab-duty 는 탭 → 섹션 식별자로 위치 이동(E2E 회귀 보존).
 *
 * AC-1: 상단 탭 스트립([직원]/[의사]) 비노출 — Tabs UI 제거.
 * AC-2: 상단 의사 근무표 + 하단 인수인계 세로 적층(단일 스크롤).
 * AC-3: 두 섹션 사이 구분선(divider) 노출.
 * AC-4: 권한가드 보존 — DUTY_ROSTER_ROLES 없는 role 에 의사 근무표 신규 노출 금지.
 * AC-5: 회귀 0 — topTab 제거로 인한 reference 에러 없음, 인수인계 기능 유지.
 *
 * 코드 레벨 검증(인증 계정 불필요) + 브라우저 통합 skip.
 * 실행: npx playwright test T-20260629-foot-HANDOVER-TAB-MERGE-SCROLL.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(process.cwd(), 'src');
const handoverSrc = readFileSync(resolve(SRC, 'pages/Handover.tsx'), 'utf-8');

// 의사 근무표 노출 role 집합 (보존되어야 함) / 신규 노출 금지 role
const DUTY_ROSTER_ROLES = ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'];
const NEWLY_FORBIDDEN_ROLES = ['part_lead', 'staff', 'tm'];

test.describe('T-20260629-foot-HANDOVER-TAB-MERGE-SCROLL', () => {

  /** 시나리오 1 / AC-1: 탭 UI 제거 — Tabs/TabsList/TabsTrigger·topTab 미존재. */
  test('AC-1 — 탭 스트립 제거 (Tabs/topTab 미존재)', () => {
    expect(handoverSrc).not.toContain('TabsTrigger');
    expect(handoverSrc).not.toContain('TabsList');
    expect(handoverSrc).not.toContain('<Tabs ');
    // topTab/setTopTab state 제거
    expect(handoverSrc).not.toContain('topTab');
    expect(handoverSrc).not.toContain('setTopTab');
    // 구 탭 컨테이너/패인 식별자 제거
    expect(handoverSrc).not.toContain('handover-top-tabs');
    expect(handoverSrc).not.toContain('handover-duty-pane');
    // tabs UI import 제거
    expect(handoverSrc).not.toMatch(/from\s+'@\/components\/ui\/tabs'/);
  });

  /** 시나리오 1 / AC-2: 단일 스크롤 컨테이너에 의사 근무표(상단) + 인수인계(하단) 세로 적층. */
  test('AC-2 — 단일 스크롤: 의사 근무표(상단) → 인수인계(하단) 세로 적층', () => {
    // 외곽 단일 스크롤 컨테이너 (className 에 overflow-y-auto + data-testid 동일 div)
    expect(handoverSrc).toContain('data-testid="handover-scroll-root"');
    expect(handoverSrc).toMatch(/className="[^"]*overflow-y-auto[^"]*"\s+data-testid="handover-scroll-root"/);
    // 두 섹션 식별자 존재 + 순서(의사 먼저, 직원 나중) = DOM 상 의사 근무표가 인수인계보다 위.
    const dutyIdx = handoverSrc.indexOf('data-testid="handover-tab-duty"');
    const boardIdx = handoverSrc.indexOf('data-testid="handover-tab-board"');
    expect(dutyIdx).toBeGreaterThan(-1);
    expect(boardIdx).toBeGreaterThan(-1);
    expect(dutyIdx).toBeLessThan(boardIdx);
    // 의사 근무표 섹션 헤더 라벨 + DutyRosterTab 렌더
    expect(handoverSrc).toContain('의사 근무표');
    expect(handoverSrc).toContain('<DutyRosterTab clinic={clinic} />');
  });

  /** 시나리오 1 / AC-3: 두 섹션 사이 구분선(divider) 노출. */
  test('AC-3 — 섹션 구분선(divider) 노출', () => {
    expect(handoverSrc).toContain('data-testid="handover-section-divider"');
    // divider 는 의사 섹션과 인수인계 섹션 사이 위치
    const dutyIdx = handoverSrc.indexOf('data-testid="handover-tab-duty"');
    const dividerIdx = handoverSrc.indexOf('data-testid="handover-section-divider"');
    const boardIdx = handoverSrc.indexOf('data-testid="handover-tab-board"');
    expect(dutyIdx).toBeLessThan(dividerIdx);
    expect(dividerIdx).toBeLessThan(boardIdx);
  });

  /** 시나리오 2 / AC-4: 권한가드 보존 — DUTY_ROSTER_ROLES 게이트, 신규 role 노출 금지. */
  test('AC-4 — 권한가드 보존: 의사 근무표 DUTY_ROSTER_ROLES 게이트', () => {
    // 게이트 변수/role 집합 보존
    expect(handoverSrc).toContain('canSeeDutyRoster');
    const rolesMatch = handoverSrc.match(/DUTY_ROSTER_ROLES\s*=\s*\[([^\]]*)\]/);
    expect(rolesMatch).not.toBeNull();
    const rolesLiteral = rolesMatch![1];
    for (const role of DUTY_ROSTER_ROLES) {
      expect(rolesLiteral).toContain(`'${role}'`);
    }
    for (const role of NEWLY_FORBIDDEN_ROLES) {
      expect(rolesLiteral).not.toContain(`'${role}'`);
    }
    // 의사 근무표 섹션·구분선 모두 canSeeDutyRoster 게이트 뒤에서만 렌더(권한 없으면 섹션 자체 비노출)
    expect(handoverSrc).toMatch(/canSeeDutyRoster && clinic[\s\S]*?handover-tab-duty/);
  });

  /** 시나리오 3 / AC-5: 회귀 — 인수인계 게시판 기존 기능(작성/캘린더/목록) 식별자 유지. */
  test('AC-5 — 회귀 0: 인수인계 게시판 기존 기능 식별자 유지', () => {
    expect(handoverSrc).toContain('data-testid="handover-new-btn"');
    expect(handoverSrc).toContain('data-testid="handover-list"');
    expect(handoverSrc).toContain('data-testid="handover-view-toggle"');
    // T-20260630-foot-HANDOVER-PARTSONLY-TOTAL-ATTEND-MONO: 파트 필터 탭 제거됨 → 부재 단언.
    expect(handoverSrc).not.toContain('data-testid="handover-part-filter"');
    expect(handoverSrc).toContain('data-testid="handover-dialog"');
    // topTab 분기 잔재로 인한 hidden 토글 제거(언제나 단일 렌더)
    expect(handoverSrc).not.toMatch(/topTab === 'duty'\s*\?\s*'hidden'/);
  });

  /**
   * 시나리오 1 브라우저 통합 (admin 계정 필요 — 평소 skip):
   *   진입 → 탭 스트립 없음 → 의사 근무표(상단) + 구분선 + 인수인계(하단) 단일 스크롤.
   */
  test.skip('브라우저 통합 — 단일 스크롤 뷰 (admin 계정 필요)', async ({ page }) => {
    const email = process.env.PLAYWRIGHT_ADMIN_EMAIL ?? '';
    const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD ?? '';
    if (!email || !password) return;

    await page.goto('/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/admin');

    await page.goto('/admin/handover');
    // 탭 스트립 비노출
    await expect(page.getByTestId('handover-top-tabs')).toHaveCount(0);
    // 의사 근무표(상단) + 구분선 + 인수인계(하단) 한 화면 적층
    await expect(page.getByTestId('handover-tab-duty')).toBeVisible();
    await expect(page.getByTestId('handover-section-divider')).toBeVisible();
    await expect(page.getByTestId('handover-tab-board')).toBeVisible();
  });
});
