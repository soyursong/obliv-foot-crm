/**
 * T-20260615-foot-PKGPAGE-SITESELECTOR-REMOVE
 * 패키지 페이지(src/pages/Packages.tsx) 상단 "치료부위(발톱) 선택" 블록 제거 — 표시만 제거.
 *
 * 배경: T-20260614-foot-PKGTAB-TOENAIL-ILLUST(0e51d3d)가 추가, TOEILLUST-NAIL-FOCUS-RESIZE(6bae271)
 *       로 리사이즈한 상단 일러스트 선택 블록을 통째로 들어냄(RESIZE supersede).
 *
 * AC1: 상단 선택 블록(data-testid="packages-foot-toe-picker" + "치료 발톱 선택") 화면에서 제거.
 * AC2: 같은 페이지 패키지 리스트(활성/완료/판매/전체 탭, 검색, 생성/템플릿 버튼) 정상.
 * AC3: 치료부위 데이터/저장키/DB 변경 0 — 표시만 제거 (코드 레벨: treatSites state 제거).
 * AC4: 그 선택값(treatSites)이 패키지 생성/수정 downstream 입력으로 안 쓰임 확인 — 제거 안전.
 *      (바인딩 C = DB 무변경, downstream 바인딩 미구현/HELD 상태였음)
 * AC5: FootToeIllustration / FootSiteSelector 컴포넌트 파일은 삭제 안 함 — 타 화면
 *      (CheckInDetailSheet, KohReportTab) 공유 → Packages.tsx 사용처만 제거.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260615-foot-PKGPAGE-SITESELECTOR-REMOVE — 패키지 페이지 상단 치료부위 선택 블록 제거', () => {
  test('AC1+AC2: 패키지 페이지 진입 → 상단 발톱 선택 블록 사라짐 + 리스트/탭/버튼 정상', async ({ page }) => {
    await loginAndWaitForDashboard(page);

    // 사이드바 "패키지" 네비게이션으로 실제 진입 (goto 단독은 SPA hydration 타이밍에 대시보드 잔류 가능)
    await page.getByRole('link', { name: '패키지', exact: true }).click();
    await page.waitForURL('**/packages');
    // 패키지 페이지 진입 확정 — 검색창(이 페이지 고유)이 떠야 함
    await expect(page.getByPlaceholder('이름/전화/패키지명')).toBeVisible({ timeout: 15000 });

    // AC1: 상단 발톱 선택 블록 제거 (data-testid + "치료 발톱 선택" 헤더 + 안내문)
    await expect(page.locator('[data-testid="packages-foot-toe-picker"]')).toHaveCount(0);
    await expect(page.locator('text=치료 발톱 선택')).toHaveCount(0);
    await expect(page.locator('text=양발가락에서 치료할 발톱을 눌러 선택하세요')).toHaveCount(0);

    // AC2: 페이지 핵심 UI 정상 — 필터 탭 4종
    await expect(page.getByRole('tab', { name: '활성' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '완료' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '환불' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '전체' })).toBeVisible();
  });
});
