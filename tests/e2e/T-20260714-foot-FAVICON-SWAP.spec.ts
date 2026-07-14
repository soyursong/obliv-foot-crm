/**
 * E2E spec — T-20260714-foot-FAVICON-SWAP
 * 풋센터 CRM 파비콘 교체 (박민지 팀장 제공 풋센터 아이콘, 투명 배경 RGBA)
 *
 * AC-1: 브라우저 탭 아이콘이 새 풋 파비콘으로 표시 (<link rel="icon"> 참조 갱신)
 * AC-2: 북마크/터치 아이콘 (apple-touch-icon) 표시
 * AC-3: 롱레/Lovable 상속 파비콘 잔재 없음 (favicon.svg 참조 제거, 캐시무효화 버전쿼리)
 *
 * 정적 asset 스왑 → 로그인 불요. 문서 <head> 링크 + 리소스 200 + content-type 검증.
 */
import { test, expect } from '@playwright/test';

test.describe('T-20260714 FAVICON-SWAP — 탭 아이콘 렌더 + 리소스 로드', () => {
  test('AC-1/3: <head> 파비콘 링크 갱신 + 상속 favicon.svg 참조 잔재 없음', async ({ page }) => {
    await page.goto('/');

    // 상속(Lovable) favicon.svg 참조가 사라졌는지
    const svgIcon = page.locator('link[rel="icon"][href*="favicon.svg"]');
    await expect(svgIcon).toHaveCount(0);

    // 신규 .ico 링크 존재 + 캐시무효화 버전쿼리
    const icoIcon = page.locator('link[rel="icon"][href*="favicon.ico"]');
    await expect(icoIcon).toHaveCount(1);
    const icoHref = await icoIcon.getAttribute('href');
    expect(icoHref).toContain('?v='); // 캐시 무효화 버전 쿼리

    // 32x32 / 64x64 PNG 아이콘 링크 존재
    await expect(page.locator('link[rel="icon"][sizes="32x32"]')).toHaveCount(1);
    await expect(page.locator('link[rel="icon"][sizes="64x64"]')).toHaveCount(1);
  });

  test('AC-2: apple-touch-icon 링크 존재', async ({ page }) => {
    await page.goto('/');
    const apple = page.locator('link[rel="apple-touch-icon"]');
    await expect(apple).toHaveCount(1);
    const href = await apple.getAttribute('href');
    expect(href).toContain('apple-touch-icon.png');
  });

  test('AC-1/2: 파비콘 리소스가 실제로 200 + 이미지 content-type 로드', async ({ page, baseURL }) => {
    const assets = [
      '/favicon.ico?v=20260714',
      '/favicon-32.png?v=20260714',
      '/favicon-64.png?v=20260714',
      '/apple-touch-icon.png?v=20260714',
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
