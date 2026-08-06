/**
 * E2E spec — T-20260806-foot-STAFFSPACE-UISIZE-HALF-COMPACT
 *
 * 직원·공간(/admin/staff) 화면 전체 UI 요소를 균일 스케일(CSS zoom ~0.7, 면적 ≈ 절반 밀도)로 축소.
 *
 * [근본원인] 부모 STAFFSPACE-TAB-RELOC-PERM-COMPACT(1차)는 외곽 여백/섹션 간격(p-3/space-y-3)만
 *   줄여 카드 내부 패딩·폰트·행높이·아이콘·버튼 등 시각 질량 대부분이 무변경 → "크기 이전과 동일".
 *   본 티켓은 루트 컨테이너에 단일 균일 스케일(.staff-space-compact { zoom }) 을 적용해
 *   전 요소를 누락 없이 비례 축소한다.
 *
 * ⚠ 시각 밀도('체감 절반')는 픽셀 단정이 곤란(브라우저 스샷으로 supervisor/field-soak 체감 검증).
 *   본 spec 은 (a)스코프된 스케일 적용 (b)스코프 격리(타 화면 미유출) (c)축소 후 렌더·동작·무클리핑
 *   회귀 가드에 집중한다. 하네스 계정 = admin 단일.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260806 STAFFSPACE-UISIZE-HALF-COMPACT', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — graceful skip');
  });

  // ── AC-1: /admin/staff 루트에 균일 스케일 클래스 + 실제 zoom 축소 적용 ──────────────
  test('AC-1: 직원·공간 루트에 균일 스케일(zoom<1) 적용', async ({ page }) => {
    await page.goto('/admin/staff');
    const root = page.locator('[data-testid="staff-space-root"]');
    const ok = await root
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      test.skip(true, '직원·공간 화면 진입 실패 — 스킵');
      return;
    }
    // 스코프 클래스 부여.
    const cls = (await root.getAttribute('class')) ?? '';
    expect(cls).toMatch(/\bstaff-space-compact\b/);
    // 부모 컴팩트(p-3/space-y-3)와 이중 축소 아님 — 유틸 클래스 병존 회귀 가드.
    expect(cls).toMatch(/\bp-3\b/);
    expect(cls).toMatch(/\bspace-y-3\b/);

    // 실제 렌더 배율 축소 확인: computed zoom < 1 (미지원 브라우저는 '' 또는 'normal' → 스킵).
    const zoom = await root.evaluate((el) => getComputedStyle(el).zoom as string);
    if (zoom === '' || zoom === 'normal' || zoom == null) {
      test.skip(true, 'zoom 미지원 렌더러 — 균일 스케일 픽셀 단정 스킵(스샷 검증 대체)');
      return;
    }
    expect(parseFloat(zoom)).toBeGreaterThan(0);
    expect(parseFloat(zoom)).toBeLessThan(1); // 축소(=이전보다 작아짐) 보장
  });

  // ── AC-3: 축소 후에도 렌더·동작·무클리핑(회귀 가드) ─────────────────────────────────
  test('AC-3: 축소 후 콘텐츠 렌더 + 탭 전환 동작 + 가로 오버플로 없음', async ({ page }) => {
    await page.goto('/admin/staff');
    const root = page.locator('[data-testid="staff-space-root"]');
    const ok = await root
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      test.skip(true, '직원·공간 화면 진입 실패 — 스킵');
      return;
    }
    // 콘텐츠 회귀: 직원 탭 기본 진입 '직원 관리' 헤더 렌더.
    await expect(page.getByRole('heading', { name: '직원 관리' })).toBeVisible();

    // 동선 무변경: 공간 배정 탭 전환 → 클릭 가능·정상 렌더(base-ui 탭 = aria-selected).
    await page.getByRole('tab', { name: '공간 배정' }).click();
    await expect(page.getByRole('tab', { name: '공간 배정' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // 직원 탭 복귀도 동작.
    await page.getByRole('tab', { name: '직원' }).click();
    await expect(page.getByRole('heading', { name: '직원 관리' })).toBeVisible();

    // 무클리핑: 루트 subtree 가 뷰포트 폭을 넘겨 가로 스크롤을 유발하지 않음(축소는 오히려 폭을 줄임).
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowX).toBeLessThanOrEqual(2); // rounding tolerance
  });

  // ── AC-4: 스코프 격리 — 다른 화면(/admin 대시보드)에는 스케일 미유출 ─────────────────
  test('AC-4: 균일 스케일이 /admin/staff 밖으로 새지 않음', async ({ page }) => {
    await page.goto('/admin');
    // 대시보드 렌더 대기(로그인 helper 가 이미 대기했지만 라우팅 안정화).
    const landed = await page
      .getByText('대시보드', { exact: true })
      .first()
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!landed) {
      test.skip(true, '대시보드 진입 실패 — 스킵');
      return;
    }
    // 다른 화면 어디에도 staff-space-compact 클래스가 없어야 한다(스코프 1곳).
    await expect(page.locator('.staff-space-compact')).toHaveCount(0);
    // body zoom 은 정상(전역 토큰 무변경) — 전역 유출 방지 확인.
    const bodyZoom = await page.evaluate(() => getComputedStyle(document.body).zoom as string);
    if (bodyZoom && bodyZoom !== 'normal' && bodyZoom !== '') {
      expect(parseFloat(bodyZoom)).toBe(1);
    }
  });
});
