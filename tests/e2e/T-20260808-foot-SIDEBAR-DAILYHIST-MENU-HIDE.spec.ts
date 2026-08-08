/**
 * T-20260808-foot-SIDEBAR-DAILYHIST-MENU-HIDE
 * 풋센터 CRM 사이드바 '일일 이력'(/admin/history) 메뉴 항목만 비노출(hidden) — 삭제 아님.
 *
 * AC-1: AdminLayout NAV_ITEMS 의 '일일 이력' 항목에 hidden:true 가 설정되어 사이드바에서 비노출.
 * AC-2: 완전 삭제 아님 — 항목·route(App.tsx /admin/history)·컴포넌트(DailyHistory.tsx) 보존(되돌리기 쉬운 토글).
 * AC-3: isNavItemVisible 이 hidden 항목을 필터링(모든 role 에서 미노출).
 * AC-4: 다른 메뉴 항목(대시보드/예약관리/…/계정관리)은 hidden 미설정 — 위치·속성 무변경.
 *
 * 실행: npx playwright test T-20260808-foot-SIDEBAR-DAILYHIST-MENU-HIDE.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ADMIN_LAYOUT = 'src/components/AdminLayout.tsx';
const APP_TSX = 'src/App.tsx';
const DAILY_HISTORY = 'src/pages/DailyHistory.tsx';

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf-8');
}

test.describe('T-20260808-foot-SIDEBAR-DAILYHIST-MENU-HIDE', () => {
  /**
   * AC-1: '일일 이력' navItem 에 hidden:true 플래그가 설정됨
   */
  test('AC-1 — 일일 이력 navItem hidden:true', () => {
    const src = read(ADMIN_LAYOUT);
    // /admin/history navItem 라인 추출
    const line = src
      .split('\n')
      .find((l) => l.includes("to: '/admin/history'") && l.includes('label:'));
    expect(line, "'/admin/history' navItem 라인이 존재해야 함").toBeTruthy();
    expect(line).toContain("label: '일일 이력'");
    expect(line).toContain('hidden: true');
  });

  /**
   * AC-2: 삭제 아님 — route + 컴포넌트 import 보존
   */
  test('AC-2 — route(/admin/history)·컴포넌트(DailyHistory) 보존', () => {
    const app = read(APP_TSX);
    // 라우트 보존
    expect(app).toContain('path="history"');
    expect(app).toContain('<DailyHistory');
    // lazy import 보존
    expect(app).toMatch(/DailyHistory\s*=\s*lazyWithRetry/);
    // 컴포넌트 파일 자체 보존
    const page = read(DAILY_HISTORY);
    expect(page).toContain('export default function DailyHistory');
  });

  /**
   * AC-3: isNavItemVisible 이 hidden 항목을 필터링
   */
  test('AC-3 — isNavItemVisible hidden 필터', () => {
    const src = read(ADMIN_LAYOUT);
    // hidden 필드 타입 선언
    expect(src).toMatch(/hidden\?\s*:\s*boolean/);
    // isNavItemVisible 함수 내 hidden 가드
    const fnStart = src.indexOf('function isNavItemVisible');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = src.slice(fnStart, fnStart + 500);
    expect(fnBody).toMatch(/if\s*\(\s*item\.hidden\s*\)\s*return\s+false/);
  });

  /**
   * AC-4: 다른 메뉴는 hidden 미설정 (일일 이력만 유일하게 hidden)
   */
  test('AC-4 — 일일 이력만 hidden, 타 메뉴 무변경', () => {
    const src = read(ADMIN_LAYOUT);
    // NAV_ITEMS 배열 블록만 추출 (선언 ~ 배열 종료)
    const arrStart = src.indexOf('}[] = [');
    const arrEnd = src.indexOf('\n];', arrStart);
    const arrBlock = src.slice(arrStart, arrEnd);

    // navItem 라인(to: '/admin...' 포함) 중 hidden: true 를 가진 라인만 카운트
    const navLines = arrBlock
      .split('\n')
      .filter((l) => /to:\s*'\/admin/.test(l));
    const hiddenLines = navLines.filter((l) => l.includes('hidden: true'));

    expect(hiddenLines).toHaveLength(1);
    expect(hiddenLines[0]).toContain("to: '/admin/history'");

    // 대표 타 메뉴 존재 + hidden 미설정 확인
    for (const to of ['/admin', '/admin/reservations', '/admin/customers', '/admin/accounts']) {
      const l = navLines.find((x) => x.includes(`to: '${to}'`) && !x.includes('/admin/history'));
      expect(l, `${to} navItem 존재`).toBeTruthy();
      expect(l).not.toContain('hidden: true');
    }
  });
});
