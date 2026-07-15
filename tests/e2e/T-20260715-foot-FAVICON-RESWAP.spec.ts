/**
 * E2E spec — T-20260715-foot-FAVICON-RESWAP
 * 풋센터 CRM 파비콘 재교체 (박민지 팀장 제공 292×315 타이트크롭 풋센터 아이콘, 투명 배경 RGBA)
 *
 * 배경: 직전 T-20260714-foot-FAVICON-SWAP(500×500) 적용본이 탭에서 "너무 작아보임" 피드백
 *        → 여백 적은 타이트 크롭 이미지로 재교체 (탭에서 더 크게 보이도록).
 *
 * AC-1: favicon 에셋 세트가 신규 이미지로 교체 (<link rel="icon"> 참조 갱신)
 * AC-2: apple-touch-icon 링크 존재
 * AC-3: 상속(Lovable) favicon.svg 참조 잔재 0
 * AC-4: 캐시 무효화 버전쿼리 ?v=20260715 부여 (현장 舊 캐시 아이콘 방지)
 * AC-5: <title> 텍스트 기존값 유지(변경 금지)
 *
 * 정적 asset 스왑 → 로그인 불요. 문서 <head> 링크 + 리소스 200 + content-type 검증.
 */
import { test, expect } from '@playwright/test';

const CACHE_VER = '20260715';
const EXPECTED_TITLE = '오블리브 풋센터 CRM';

test.describe('T-20260715 FAVICON-RESWAP — 탭 아이콘 재교체 + 캐시 무효화', () => {
  test('AC-1/3/4: <head> 파비콘 링크 갱신 + favicon.svg 잔재 없음 + ?v=20260715', async ({ page }) => {
    await page.goto('/');

    // 상속(Lovable) favicon.svg 참조가 없는지
    await expect(page.locator('link[rel="icon"][href*="favicon.svg"]')).toHaveCount(0);

    // 신규 .ico 링크 존재 + 신규 캐시무효화 버전쿼리
    const icoIcon = page.locator('link[rel="icon"][href*="favicon.ico"]');
    await expect(icoIcon).toHaveCount(1);
    const icoHref = await icoIcon.getAttribute('href');
    expect(icoHref).toContain(`?v=${CACHE_VER}`);

    // 32x32 / 64x64 PNG 아이콘 링크 존재 + 신규 버전쿼리
    for (const size of ['32x32', '64x64']) {
      const link = page.locator(`link[rel="icon"][sizes="${size}"]`);
      await expect(link).toHaveCount(1);
      expect(await link.getAttribute('href')).toContain(`?v=${CACHE_VER}`);
    }
  });

  test('AC-2: apple-touch-icon 링크 존재 + 신규 버전쿼리', async ({ page }) => {
    await page.goto('/');
    const apple = page.locator('link[rel="apple-touch-icon"]');
    await expect(apple).toHaveCount(1);
    const href = await apple.getAttribute('href');
    expect(href).toContain('apple-touch-icon.png');
    expect(href).toContain(`?v=${CACHE_VER}`);
  });

  test('AC-5: <title> 텍스트 기존값 유지(변경 금지)', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(EXPECTED_TITLE);
  });

  test('AC-1/2: 파비콘 리소스가 실제로 200 + 이미지 content-type 로드', async ({ page, baseURL }) => {
    const assets = [
      `/favicon.ico?v=${CACHE_VER}`,
      `/favicon-32.png?v=${CACHE_VER}`,
      `/favicon-64.png?v=${CACHE_VER}`,
      `/apple-touch-icon.png?v=${CACHE_VER}`,
    ];
    for (const path of assets) {
      const res = await page.request.get(new URL(path, baseURL).toString());
      expect(res.status(), `${path} status`).toBe(200);
      const ct = res.headers()['content-type'] || '';
      expect(ct, `${path} content-type`).toMatch(/image\/(x-icon|vnd\.microsoft\.icon|png)/);
      const buf = await res.body();
      expect(buf.byteLength, `${path} non-empty`).toBeGreaterThan(0);
    }
  });
});
