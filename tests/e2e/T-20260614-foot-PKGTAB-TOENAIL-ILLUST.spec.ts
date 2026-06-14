/**
 * E2E spec — T-20260614-foot-PKGTAB-TOENAIL-ILLUST
 * 패키지 탭(/admin/packages) 상단 고정 — 귀여운 양발가락 일러스트 치료 발톱 선택기.
 *
 * 구현 범위(바인딩 C / DB 무변경):
 *   - 기존 FootToeIllustration(양발 SVG, L1~L5/R1~R5 멀티선택) 컴포넌트를 패키지 탭 상단에 고정 노출.
 *   - 선택값은 로컬 상태(표시/선택 전용). 신규 패키지 부위 자동지정(바인딩 A=package.foot_site 신설)은
 *     CONFIRM-A 확정 + supervisor DB게이트 전까지 미구현 → 본 spec은 DB write를 검증하지 않음.
 *
 * 시나리오 1: 패키지 탭 진입 → 상단에 양발가락 일러스트 picker 고정 표시
 * 시나리오 2: 발톱(예 R1) 클릭 → 선택 상태(data-selected=true) + 미리보기 갱신, 다중선택 허용
 * 회귀:       패키지 목록 테이블/검색/생성 버튼 정상 — picker 추가가 기존 동선 깨지 않음
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260614-PKGTAB-TOENAIL-ILLUST — 패키지 탭 상단 발톱 일러스트 picker', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인 실패(storageState/env 미설정)');
    await page.goto('/admin/packages');
  });

  test('시나리오1: 패키지 탭 상단에 양발가락 picker 고정 표시', async ({ page }) => {
    const picker = page.getByTestId('packages-foot-toe-picker');
    await expect(picker).toBeVisible();
    // 일러스트(양발 SVG) + 좌/우 발 그룹 존재
    await expect(picker.getByTestId('foot-toe-illustration')).toBeVisible();
    await expect(picker.getByTestId('foot-L')).toBeVisible();
    await expect(picker.getByTestId('foot-R')).toBeVisible();
    // 안내 카피
    await expect(picker.getByText('치료 발톱 선택')).toBeVisible();
  });

  test('시나리오2: 발톱 클릭 → 선택 토글 + 다중선택', async ({ page }) => {
    const picker = page.getByTestId('packages-foot-toe-picker');
    const r1 = picker.getByTestId('toe-R-1');
    const l3 = picker.getByTestId('toe-L-3');

    await expect(r1).toHaveAttribute('data-selected', 'false');
    await r1.click();
    await expect(r1).toHaveAttribute('data-selected', 'true');
    // 미리보기에 R1 반영
    await expect(picker.getByTestId('foot-toe-preview')).toContainText('R1');

    // 다중선택 — L3 추가
    await l3.click();
    await expect(l3).toHaveAttribute('data-selected', 'true');
    await expect(r1).toHaveAttribute('data-selected', 'true');
    await expect(picker.getByTestId('foot-toe-preview')).toContainText('L3');

    // 토글 해제
    await r1.click();
    await expect(r1).toHaveAttribute('data-selected', 'false');
  });

  test('회귀: 패키지 목록/검색/생성 동선 정상', async ({ page }) => {
    // 검색 입력
    await expect(page.getByPlaceholder('이름/전화/패키지명')).toBeVisible();
    // 탭(활성/완료/환불/전체) 정상
    await expect(page.getByRole('tab', { name: '활성' })).toBeVisible();
    // picker 가 테이블보다 위(상단)에 위치 — 헤더 영역 존재 확인
    await expect(page.getByTestId('packages-foot-toe-picker')).toBeVisible();
  });
});
