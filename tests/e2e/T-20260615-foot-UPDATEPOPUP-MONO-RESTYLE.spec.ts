/**
 * T-20260615-foot-UPDATEPOPUP-MONO-RESTYLE — 업데이트 안내 팝업창 모노톤 리스타일(순수 FE 코스메틱).
 *
 * 배경(김주연 총괄, thread 1781524342.901559): 업데이트 배포 시 노출되는 "업데이트 안내 팝업"이
 *   색이 과하고 너무 크다는 현장 피드백 → 시각 스타일만 다듬는다.
 *   대상 컴포넌트 = UpdateBanner(앱 내 유일한 업데이트 안내 컴포넌트, REFRESH-BANNER-AUTOLO와 동일 surface).
 *
 * AC1: 색상 모노톤화 — 컬러 액센트(emerald) 제거 → 회색조(slate/neutral). 강조 버튼은 식별성만 유지(채도↓).
 * AC2: 글씨 크기 축소 — 팝업 내 텍스트 font-size 전반 축소.
 * AC3: 팝업 너비 축소 — 전폭(full-width) → 좁은 카드(max-w-md). 텍스트/버튼 레이아웃 깨짐 없음.
 *
 * 회귀(REFRESH-BANNER-AUTOLO 회귀 0): 노출 트리거/카운트다운/자동 새로고침/버튼 동작 불변.
 *
 * 전략: REFRESH-BANNER-AUTOLO spec 관례 그대로 /version.json 을 모킹해 '새 버전' 재현.
 *   스타일은 tailwind 클래스가 아니라 getComputedStyle 실측값으로 단언(클래스명 변경에 강건).
 */
import { test, expect, type Page } from '@playwright/test';

/** /version.json 을 임의 buildId 로 모킹 → 로컬 번들과 불일치 = '새 버전'. */
async function mockNewVersion(page: Page, buildId = 'REMOTE-NEW-BUILD-restyle') {
  await page.route('**/version.json*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ buildId, builtAt: new Date().toISOString() }),
    });
  });
}

const banner = (page: Page) => page.getByTestId('app-update-banner');
const reloadBtn = (page: Page) => page.getByTestId('app-update-reload');

/** "rgb(r, g, b)" → [r,g,b]. */
function parseRgb(s: string): [number, number, number] {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) throw new Error(`rgb 파싱 실패: ${s}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
/**
 * 채도(saturation = (max-min)/max). AC1 판정: 컬러 액센트(emerald 등 vivid) 제거 = 저채도.
 * AC가 허용한 slate 계열(차가운 틴트, 채도 ~0.4~0.5)은 통과하되, emerald-600(채도 ~0.97) 같은
 * vivid 액센트는 거른다. RGB 절대편차 대신 채도를 쓰는 이유: slate는 dark에서 채널 스프레드가
 * 커도 채도(상대값)는 낮은 회색조이기 때문.
 */
function saturation([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}
/** 저채도(모노톤/회색조)면 true. slate(≤~0.5) 통과, emerald-600(~0.97) 탈락. */
function isMonotone(rgb: [number, number, number], maxSat = 0.6): boolean {
  return saturation(rgb) <= maxSat;
}

// ── AC1: 색상 모노톤화 (배경·텍스트가 회색조, emerald 액센트 없음) ──────────────
test('AC1: 업데이트 안내 팝업 배경/텍스트가 회색조(모노톤)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __updateCountdownSeconds?: number }).__updateCountdownSeconds = 30; // 자동 reload 방지
  });
  await mockNewVersion(page);
  await page.goto('/');

  await expect(banner(page)).toBeVisible({ timeout: 8000 });

  const bg = await banner(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  const fg = await banner(page).evaluate((el) => getComputedStyle(el).color);
  expect(isMonotone(parseRgb(bg)), `배경이 저채도(모노톤)여야 함 (got ${bg})`).toBe(true);
  expect(isMonotone(parseRgb(fg)), `텍스트가 저채도(모노톤)여야 함 (got ${fg})`).toBe(true);

  // 강조 버튼은 식별성 유지(채도 낮춘 회색조). emerald 같은 vivid 액센트가 아님.
  const btnBg = await reloadBtn(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(isMonotone(parseRgb(btnBg)), `버튼 배경이 저채도(모노톤)여야 함 (got ${btnBg})`).toBe(true);
});

// ── AC2: 글씨 크기 축소 (메시지 텍스트 font-size 작게) ─────────────────────────
test('AC2: 팝업 내 텍스트 폰트 크기가 작음(≤14px)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __updateCountdownSeconds?: number }).__updateCountdownSeconds = 30;
  });
  await mockNewVersion(page);
  await page.goto('/');

  await expect(banner(page)).toBeVisible({ timeout: 8000 });
  const msgFont = await banner(page)
    .locator('span')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  // 종전 sm:text-base(16px) → text-sm(14px) 이하로 축소.
  expect(msgFont).toBeLessThanOrEqual(14);
});

// ── AC3: 팝업 너비 축소 (전폭 아님, 좁은 카드) ─────────────────────────────────
test('AC3: 팝업 너비가 전폭이 아니라 좁은 카드(< viewport, ≤ 약 480px)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __updateCountdownSeconds?: number }).__updateCountdownSeconds = 30;
  });
  await mockNewVersion(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await expect(banner(page)).toBeVisible({ timeout: 8000 });
  const box = await banner(page).boundingBox();
  expect(box).not.toBeNull();
  // 전폭이 아니어야 함 + max-w-md(~448px) 근방.
  expect(box!.width).toBeLessThan(1280);
  expect(box!.width).toBeLessThanOrEqual(480);

  // 좁아진 width에서 버튼이 여전히 렌더되고 클릭 가능(레이아웃 깨짐 없음).
  await expect(reloadBtn(page)).toBeVisible();
});

// ── 회귀(REFRESH-BANNER-AUTOLO 회귀 0): 동작·구조 불변 ─────────────────────────
test('회귀: 카운트다운 안내·버튼·role 동작 불변 (별도 dialog 아님)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __updateCountdownSeconds?: number }).__updateCountdownSeconds = 30;
  });
  await mockNewVersion(page);
  await page.goto('/');

  await expect(banner(page)).toBeVisible({ timeout: 8000 });
  // 안내 메시지(카운트다운 텍스트) 동일.
  await expect(banner(page)).toContainText('자동으로 화면이 업데이트됩니다');
  await expect(banner(page)).toHaveAttribute('role', 'status');
  // 여전히 inline 배너(별도 팝업 dialog 아님) — 동작 surface 불변.
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  // "지금 새로고침" 버튼 존재·활성(즉시 새로고침 동작 보존).
  await expect(reloadBtn(page)).toBeVisible();
  await expect(reloadBtn(page)).toBeEnabled();
});
